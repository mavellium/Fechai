"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { payloadTooLarge } from "@/lib/rate-limit";
import { getWhatsAppProvider } from "@/modules/whatsapp";
import { deployTenantWidget, WIDGET_CONFIG_SELECT } from "@/lib/widget/deploy";
import { uploadToBunny } from "@/lib/bunny";
import { setCalendarFeature, type CalendarFeatureKey } from "@/modules/scheduling/features";
import { disconnectGoogleCalendar } from "@/modules/scheduling/google";
import {
  disconnectClinicorp,
  listClinicorpProfessionals,
  saveClinicorpCredentials,
  verifyClinicorpCredentials,
} from "@/modules/scheduling/clinicorp";
import { isEncryptionConfigured } from "@/lib/crypto";

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
  revalidatePath(`/agentes/${agent.id}`);
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
  const tooLarge = payloadTooLarge(formData);
  if (tooLarge) return { ok: false, error: tooLarge };

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

/**
 * Habilita ou desabilita um calendário.
 *
 * Só a decisão "quero usar isso": as credenciais e a configuração ficam na
 * /agenda, e desabilitar aqui **não** as apaga (isso é desconectar, lá). Quem
 * desliga por uma semana reencontra tudo ao religar.
 */
export async function setCalendarFeatureAction(
  key: CalendarFeatureKey,
  enabled: boolean,
): Promise<WhatsappControlResult> {
  const { tenantId } = await requireTenant();
  await setCalendarFeature(tenantId, key, enabled);
  revalidatePath("/integracoes");
  revalidatePath("/agenda");
  return {
    ok: true,
    info: enabled ? "Calendário habilitado. Configure na Agenda." : "Calendário desabilitado.",
  };
}

// --- Calendários: Google e Clinicorp --------------------------------------

/** Desliga o espelhamento sem desfazer a autorização do Google. */
export async function setGoogleSyncEnabled(enabled: boolean): Promise<WhatsappControlResult> {
  const { tenantId } = await requireTenant();
  const { count } = await prisma.calendarIntegration.updateMany({
    where: { tenantId },
    data: { syncEnabled: enabled },
  });
  if (count === 0) return { ok: false, error: "Google Agenda não está conectado." };
  revalidatePath("/integracoes");
  revalidatePath("/agenda");
  return { ok: true };
}

export async function disconnectGoogleAction(): Promise<WhatsappControlResult> {
  const { tenantId } = await requireTenant();
  await disconnectGoogleCalendar(tenantId);
  revalidatePath("/integracoes");
  revalidatePath("/agenda");
  return { ok: true, info: "Google Agenda desconectado." };
}

// --- Clinicorp ------------------------------------------------------------

const clinicorpSchema = z.object({
  apiUser: z.string().trim().min(1, "Informe o usuário da API"),
  apiToken: z.string().trim().min(1, "Informe o token da API"),
  subscriberId: z.string().trim().min(1, "Informe o id do assinante"),
});

/**
 * Conecta a conta ao Clinicorp.
 *
 * As credenciais só são gravadas depois de a API aceitá-las: colar um token
 * errado e só descobrir dias depois, quando um agendamento não chegou na
 * clínica, seria o pior jeito de errar. A mesma chamada devolve as clínicas do
 * assinante, e quando só existe uma ela já fica escolhida — a maioria das
 * contas não é franquia e não deveria ter que escolher nada.
 */
export async function connectClinicorpAction(
  _prev: WhatsappControlResult | null,
  formData: FormData,
): Promise<WhatsappControlResult> {
  const tooLarge = payloadTooLarge(formData);
  if (tooLarge) return { ok: false, error: tooLarge };

  const { tenantId } = await requireTenant();
  const parsed = clinicorpSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  // Sem chave de criptografia não se guarda credencial de cliente em texto
  // claro: recusa com uma mensagem útil em vez de deixar `encryptSecret` lançar.
  if (!isEncryptionConfigured()) {
    return {
      ok: false,
      error: "Integração indisponível nesta instalação — falta a chave de criptografia no servidor.",
    };
  }

  const check = await verifyClinicorpCredentials(parsed.data);
  if (!check.ok) return { ok: false, error: check.error };

  // Uma clínica só: já fica escolhida. A maioria das contas não é franquia e não
  // deveria ter que escolher nada.
  const onlyBusiness = check.businesses.length === 1 ? check.businesses[0].id : null;

  await saveClinicorpCredentials(tenantId, parsed.data, { businessId: onlyBusiness });

  revalidatePath("/integracoes");
  revalidatePath("/agenda");
  return { ok: true, info: "Clinicorp conectado." };
}

const clinicorpSettingsSchema = z.object({
  businessId: z.string().trim().optional(),
  dentistId: z.string().trim().optional(),
  categoryDescription: z.string().trim().max(120).optional(),
});

export async function saveClinicorpSettingsAction(
  _prev: WhatsappControlResult | null,
  formData: FormData,
): Promise<WhatsappControlResult> {
  const tooLarge = payloadTooLarge(formData);
  if (tooLarge) return { ok: false, error: tooLarge };

  const { tenantId } = await requireTenant();
  const parsed = clinicorpSettingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const { count } = await prisma.clinicorpIntegration.updateMany({
    where: { tenantId },
    data: {
      businessId: parsed.data.businessId || null,
      dentistId: parsed.data.dentistId || null,
      categoryDescription: parsed.data.categoryDescription || null,
    },
  });
  if (count === 0) return { ok: false, error: "Clinicorp não está conectado." };

  revalidatePath("/integracoes");
  revalidatePath("/agenda");
  return { ok: true, info: "Preferências salvas." };
}

/** Espelhar novos horários e ler a agenda de lá são dois botões separados. */
export async function setClinicorpToggle(
  field: "syncEnabled" | "checkAvailability",
  enabled: boolean,
): Promise<WhatsappControlResult> {
  const { tenantId } = await requireTenant();
  const { count } = await prisma.clinicorpIntegration.updateMany({
    where: { tenantId },
    data: { [field]: enabled },
  });
  if (count === 0) return { ok: false, error: "Clinicorp não está conectado." };
  revalidatePath("/integracoes");
  revalidatePath("/agenda");
  return { ok: true };
}

export async function disconnectClinicorpAction(): Promise<WhatsappControlResult> {
  const { tenantId } = await requireTenant();
  await disconnectClinicorp(tenantId);
  revalidatePath("/integracoes");
  revalidatePath("/agenda");
  return { ok: true, info: "Clinicorp desconectado." };
}

/** Profissionais para o seletor — buscado sob demanda, não a cada render. */
export async function loadClinicorpProfessionalsAction() {
  const { tenantId } = await requireTenant();
  return listClinicorpProfessionals(tenantId);
}
