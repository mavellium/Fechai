"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getWhatsAppProvider } from "@/modules/whatsapp";
import { deployTenantWidget, WIDGET_CONFIG_SELECT } from "@/lib/widget/deploy";
import { uploadToBunny } from "@/lib/bunny";

type ConnectResult = {
  ok: boolean;
  status?: string;
  qrCode?: string;
  error?: string;
};

export async function connectWhatsapp(): Promise<ConnectResult> {
  const { tenantId } = await requireTenant();
  const provider = getWhatsAppProvider();

  if (!provider.isConfigured()) {
    return { ok: false, error: "Evolution API não configurada (EVOLUTION_API_URL / EVOLUTION_API_KEY)." };
  }

  try {
    const existing = await prisma.whatsappInstance.findUnique({ where: { tenantId } });
    // Instância já criada: só atualiza o QR. Recriar com o mesmo nome devolve
    // 403 da Evolution (instância em uso) e quebrava a tela na 2ª visita.
    const res = existing?.externalId
      ? { externalId: existing.externalId, ...(await provider.getQrCode(existing.externalId)) }
      : await provider.createInstance(tenantId);
    await prisma.whatsappInstance.upsert({
      where: { tenantId },
      create: { tenantId, externalId: res.externalId, status: res.status },
      update: { externalId: res.externalId, status: res.status },
    });
    revalidatePath("/integracoes");
    revalidatePath("/inicio");
    return { ok: true, status: res.status, qrCode: res.qrCode };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Falha ao conectar" };
  }
}

export async function refreshWhatsappStatus(): Promise<ConnectResult> {
  const { tenantId } = await requireTenant();
  const provider = getWhatsAppProvider();
  const instance = await prisma.whatsappInstance.findUnique({ where: { tenantId } });
  if (!instance?.externalId) return { ok: false, error: "Nenhuma instância criada ainda." };
  if (!provider.isConfigured()) return { ok: false, error: "Evolution API não configurada." };

  try {
    const res = await provider.getQrCode(instance.externalId);
    await prisma.whatsappInstance.update({ where: { tenantId }, data: { status: res.status } });
    revalidatePath("/integracoes");
    revalidatePath("/inicio");
    return { ok: true, status: res.status, qrCode: res.qrCode };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Falha ao atualizar" };
  }
}

type WhatsappControlResult = { ok: boolean; error?: string; info?: string };

/**
 * Desloga o número da instância na Evolution e marca como desconectado no
 * banco. Alternativa ao "desligar" (que só cala o agente): aqui o WhatsApp
 * inteiro sai — volta a conectar exige novo QR. Se a Evolution falhar,
 * retorna o erro sem marcar como desconectado (senão enganaríamos a tela).
 */
export async function disconnectWhatsapp(): Promise<WhatsappControlResult> {
  const { tenantId } = await requireTenant();
  const provider = getWhatsAppProvider();
  const instance = await prisma.whatsappInstance.findUnique({ where: { tenantId } });
  if (!instance?.externalId) return { ok: false, error: "Nenhum número conectado." };
  if (!provider.isConfigured()) return { ok: false, error: "Evolution API não configurada." };

  try {
    await provider.disconnect(instance.externalId);
  } catch (err) {
    console.error("[whatsapp] falha ao desconectar na Evolution", err);
    return { ok: false, error: err instanceof Error ? err.message : "Falha ao desconectar" };
  }

  await prisma.whatsappInstance.update({
    where: { tenantId },
    data: { status: "disconnected" },
  });
  revalidatePath("/integracoes");
  revalidatePath("/inicio");
  return { ok: true, info: "WhatsApp desconectado. Para voltar, gere um novo código." };
}

/**
 * Pausa/retoma o agente que atende o WhatsApp (o principal, ou o mais antigo
 * se nenhum for marcado como principal). Espelha o `enabled` da página de
 * agentes — o mesmo campo que o `runAgentTurn` respeita para calar o bot.
 */
export async function setWhatsappAgentEnabled(enabled: boolean): Promise<WhatsappControlResult> {
  const { tenantId } = await requireTenant();
  const agent = await prisma.agent.findFirst({
    where: { tenantId, archived: false },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    select: { id: true, name: true },
  });
  if (!agent) return { ok: false, error: "Nenhum agente nesta conta." };

  await prisma.agent.update({ where: { id: agent.id }, data: { enabled } });
  revalidatePath("/integracoes");
  revalidatePath("/agentes");
  revalidatePath("/inicio");
  return { ok: true, info: enabled ? `${agent.name} voltou a responder.` : `${agent.name} parou de responder.` };
}

/** Configura se o agente ignora mensagens de grupos do WhatsApp. */
export async function setWhatsappIgnoreGroups(ignore: boolean): Promise<WhatsappControlResult> {
  const { tenantId } = await requireTenant();
  await prisma.tenant.update({ where: { id: tenantId }, data: { whatsappIgnoreGroups: ignore } });
  revalidatePath("/integracoes");
  return {
    ok: true,
    info: ignore ? "O agente ignora mensagens de grupos." : "O agente passa a responder em grupos.",
  };
}

// --------------------------------------------------------- widget do site

type WidgetConfigResult = { ok: boolean; error?: string; info?: string };

const MAX_ICON_BYTES = 5 * 1024 * 1024;

const widgetConfigSchema = z.object({
  widgetColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Cor inválida — use o seletor ao lado."),
  widgetGreeting: z.string().trim().min(1, "Escreva uma saudação").max(200, "Saudação muito longa"),
  widgetIconType: z.enum(["emoji", "image"], { message: "Tipo de ícone inválido" }),
  widgetIconEmoji: z.string().trim().min(1, "Escolha um emoji").max(8, "Use só um emoji"),
  widgetShape: z.enum(["circle", "rounded", "square"], { message: "Formato inválido" }),
  widgetBorderColor: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .refine((v) => v === null || /^#[0-9a-fA-F]{6}$/.test(v), "Cor de borda inválida"),
});

/**
 * Salva a personalização do widget (cor, saudação, ícone, formato, borda) e
 * republica o widget.js daquele tenant na CDN com os novos valores já
 * embutidos — automático, sem comando manual. O snippet no site do cliente
 * não muda.
 */
export async function updateWidgetConfig(
  _prev: WidgetConfigResult | null,
  formData: FormData,
): Promise<WidgetConfigResult> {
  const { tenantId } = await requireTenant();

  const currentTenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { widgetEnabled: true },
  });

  const parsed = widgetConfigSchema.safeParse({
    widgetColor: formData.get("widgetColor"),
    widgetGreeting: formData.get("widgetGreeting"),
    widgetIconType: formData.get("widgetIconType"),
    widgetIconEmoji: formData.get("widgetIconEmoji"),
    widgetShape: formData.get("widgetShape"),
    widgetBorderColor: formData.get("widgetBorderColor"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  let widgetIconUrl: string | null = null;
  if (parsed.data.widgetIconType === "image") {
    const iconImage = formData.get("widgetIconImage");
    if (iconImage instanceof File && iconImage.size > 0) {
      if (iconImage.size > MAX_ICON_BYTES) {
        return { ok: false, error: "Imagem do ícone muito grande. O máximo é 5MB." };
      }
      const safeName = iconImage.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const uploaded = await uploadToBunny(
        `widget-icons/${tenantId}/${Date.now()}-${safeName}`,
        Buffer.from(await iconImage.arrayBuffer()),
        iconImage.type || "application/octet-stream",
      );
      if (!uploaded.ok) {
        return { ok: false, error: `Falha ao enviar ícone: ${uploaded.error}` };
      }
      widgetIconUrl = uploaded.url;
    } else {
      // Sem arquivo novo: mantém o ícone já salvo, se houver.
      const current = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { widgetIconUrl: true },
      });
      widgetIconUrl = current?.widgetIconUrl ?? null;
      if (!widgetIconUrl) return { ok: false, error: "Envie uma imagem para o ícone." };
    }
  }

  const deployed = await deployTenantWidget({
    tenantId,
    enabled: currentTenant?.widgetEnabled ?? false,
    color: parsed.data.widgetColor,
    greeting: parsed.data.widgetGreeting,
    iconType: parsed.data.widgetIconType,
    iconEmoji: parsed.data.widgetIconEmoji,
    iconUrl: widgetIconUrl,
    shape: parsed.data.widgetShape,
    borderColor: parsed.data.widgetBorderColor,
  });
  if (!deployed.ok) {
    return { ok: false, error: `Não consegui publicar o widget na CDN: ${deployed.error}` };
  }

  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      widgetColor: parsed.data.widgetColor,
      widgetGreeting: parsed.data.widgetGreeting,
      widgetIconType: parsed.data.widgetIconType,
      widgetIconEmoji: parsed.data.widgetIconEmoji,
      widgetIconUrl,
      widgetShape: parsed.data.widgetShape,
      widgetBorderColor: parsed.data.widgetBorderColor,
      widgetDeployedAt: new Date(),
    },
  });
  revalidatePath("/integracoes");
  return { ok: true, info: "Personalização salva e publicada." };
}

/**
 * Liga/desliga o botão no site do cliente. Por padrão ele nasce desativado
 * (`widgetEnabled = false`): colar o snippet só instala o script, e o botão
 * só aparece depois deste comando — republica o widget.js com a flag nova
 * embutida, sem mudar nada no site do cliente.
 */
export async function setWidgetEnabled(enabled: boolean): Promise<WidgetConfigResult> {
  const { tenantId } = await requireTenant();

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { ...WIDGET_CONFIG_SELECT, widgetDeployedAt: true },
  });
  if (!tenant) return { ok: false, error: "Conta não encontrada." };

  const deployed = await deployTenantWidget({
    tenantId,
    enabled,
    color: tenant.widgetColor,
    greeting: tenant.widgetGreeting,
    iconType: tenant.widgetIconType,
    iconEmoji: tenant.widgetIconEmoji,
    iconUrl: tenant.widgetIconUrl,
    shape: tenant.widgetShape,
    borderColor: tenant.widgetBorderColor,
  });
  if (!deployed.ok) {
    return { ok: false, error: `Não consegui publicar o widget na CDN: ${deployed.error}` };
  }

  await prisma.tenant.update({
    where: { id: tenantId },
    data: { widgetEnabled: enabled, widgetDeployedAt: new Date() },
  });
  revalidatePath("/integracoes");
  return { ok: true, info: enabled ? "O botão agora aparece no seu site." : "O botão foi desativado no seu site." };
}
