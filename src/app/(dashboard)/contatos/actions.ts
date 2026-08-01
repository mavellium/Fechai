"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getWhatsAppProvider } from "@/modules/whatsapp";
import { getOrCreateConversation } from "@/modules/agent-engine/conversation";

type Result = { ok: boolean; error?: string; info?: string };

const MESSAGE_LIMIT = 4096;

const messageSchema = z
  .string()
  .trim()
  .min(1, "Escreva a mensagem antes de enviar")
  .max(MESSAGE_LIMIT, `Mensagem muito longa (máx. ${MESSAGE_LIMIT} caracteres)`);

const phoneSchema = z
  .string()
  .trim()
  .min(1, "Informe o telefone do contato");

const nameSchema = z.string().trim().max(80, "Nome muito longo").optional();

/** Normaliza para E.164 (55 + DDD + número). Aceita formato livre do Brasil. */
function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 13) return null;
  if (!/^[1-9]/.test(digits)) return null;
  return digits.length <= 11 ? `55${digits}` : digits;
}

function revalidateContatos() {
  revalidatePath("/contatos");
  revalidatePath("/conversas");
  revalidatePath("/inicio");
}

/**
 * Envia uma mensagem para o WhatsApp de um contato da conta. Persiste a
 * mensagem como do agente (role "assistant") para ela aparecer em /conversas.
 */
export async function sendMessageToContact(leadId: string, text: string): Promise<Result> {
  const { tenantId } = await requireTenant();
  const parsed = messageSchema.safeParse(text);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };

  const lead = await prisma.lead.findFirst({
    where: { id: leadId, tenantId },
    include: { conversation: true },
  });
  if (!lead) return { ok: false, error: "Contato não encontrado." };
  if (lead.phone === "sandbox") {
    return { ok: false, error: "O contato Sandbox é um teste — envie para um WhatsApp real." };
  }

  const provider = getWhatsAppProvider();
  if (!provider.isConfigured()) {
    return { ok: false, error: "Evolution API não configurada (EVOLUTION_API_URL / EVOLUTION_API_KEY)." };
  }

  const instance = await prisma.whatsappInstance.findUnique({ where: { tenantId } });
  if (!instance?.externalId || instance.status !== "connected") {
    return {
      ok: false,
      error: "O WhatsApp não está conectado. Conecte na tela WhatsApp antes de enviar.",
    };
  }

  try {
    await provider.sendMessage(instance.externalId, lead.phone, parsed.data);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Falha ao enviar a mensagem." };
  }

  const { conversation } = await getOrCreateConversation(tenantId, lead.phone, lead.name ?? undefined);
  await prisma.message.create({
    data: { conversationId: conversation.id, role: "assistant", content: parsed.data },
  });
  await prisma.conversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });

  revalidateContatos();
  return { ok: true, info: "Mensagem enviada." };
}

/**
 * Cadastra um contato novo (nome + telefone). Se o número já existir na conta,
 * devolve o contato existente em vez de duplicar (mesma regra do webhook).
 */
export async function addContact(_prev: Result | null, formData: FormData): Promise<Result> {
  const { tenantId } = await requireTenant();

  const rawPhone = phoneSchema.safeParse(formData.get("phone"));
  if (!rawPhone.success) return { ok: false, error: rawPhone.error.issues[0]?.message };

  const phone = normalizePhone(rawPhone.data);
  if (!phone) {
    return { ok: false, error: "Telefone inválido. Use DDD + número (ex.: 11 99999-9999)." };
  }

  const name = nameSchema.safeParse(String(formData.get("name") ?? "").trim());
  if (!name.success) return { ok: false, error: name.error.issues[0]?.message };

  const existed = await prisma.lead.findFirst({ where: { tenantId, phone } });
  const { lead } = await getOrCreateConversation(tenantId, phone, name.data || undefined);
  revalidateContatos();
  return { ok: true, info: existed ? "Este número já está na sua lista." : `Contato ${lead.name ?? ""} adicionado.` };
}
