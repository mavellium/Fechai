import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { normalizeGroupId } from "@/modules/agent-engine/handoff";
import { TIMEZONES } from "@/modules/scheduling/time";
import { parseGapSettings, type GapResponders, type GapSettings } from "./settings";

const flag = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());

/**
 * O que a clínica ajusta na tela. `responders` fica de fora de propósito:
 * quem responde a fila é combinado com a Mavellium e só o superadmin muda
 * (`setGapResponders`) — senão a clínica esconderia a fila de quem ela
 * contratou para responder.
 */
export const gapSettingsFormSchema = z
  .object({
    onUnanswered: z.enum(["keep", "handoff"], { message: "Escolha o que fazer com a conversa." }),
    notifyEmail: flag,
    notifyWhatsapp: flag,
    groupId: z.string().trim().max(120).optional().default(""),
    groupName: z.string().trim().max(100).optional().default(""),
    immediate: flag,
    dailyDigest: flag,
    digestHour: z.coerce.number().int().min(0, "Hora inválida.").max(23, "Hora inválida."),
    timezone: z.string().refine((v) => TIMEZONES.some((z) => z.value === v), "Fuso inválido."),
  })
  .superRefine((data, ctx) => {
    // Recusa antes de normalizar: ligado com ID inválido não pode virar
    // "salvo" com o aviso desligado em silêncio (mesma regra da transferência).
    if (data.notifyWhatsapp && !normalizeGroupId(data.groupId)) {
      ctx.addIssue({ code: "custom", path: ["groupId"], message: "Escolha o grupo do WhatsApp que recebe os avisos." });
    }
  });

export type GapSettingsForm = z.infer<typeof gapSettingsFormSchema>;

export async function saveGapSettings(tenantId: string, data: GapSettingsForm): Promise<GapSettings> {
  const groupId = normalizeGroupId(data.groupId);
  const values = {
    onUnanswered: data.onUnanswered,
    notifyEmail: data.notifyEmail,
    notifyWhatsapp: data.notifyWhatsapp && Boolean(groupId),
    // Desligar o aviso no grupo não apaga a escolha: é pausa, não descadastro.
    groupId,
    groupName: groupId && data.groupName ? data.groupName : null,
    immediate: data.immediate,
    dailyDigest: data.dailyDigest,
    digestHour: data.digestHour,
    timezone: data.timezone,
  };
  const row = await prisma.knowledgeGapSettings.upsert({
    where: { tenantId },
    create: { tenantId, ...values },
    update: values,
  });
  return parseGapSettings(row);
}

export async function setGapResponders(tenantId: string, responders: GapResponders): Promise<void> {
  await prisma.knowledgeGapSettings.upsert({
    where: { tenantId },
    create: { tenantId, responders },
    update: { responders },
  });
}
