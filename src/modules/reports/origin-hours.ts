import { prisma } from "@/lib/prisma";
import { originHours, type OriginHours } from "@/modules/scheduling/dimensions";
import { outsideHumanHours, parseMonthlyAssumptions } from "./monthly-config";

/**
 * "Horário de origem" de uma lista de agendamentos: a primeira mensagem do
 * contato chegou dentro ou fora do expediente humano?
 *
 * O expediente é o das premissas do ROI mensal (`humanHours`, conferido pela
 * Mavellium) — a mesma régua do relatório, para a /agenda e o PDF nunca
 * discordarem. Usa a competência mais recente que tem premissas. Sem
 * expediente informado, ou sem mensagem do contato antes da marcação, é
 * "não classificado": nunca "dentro" presumido.
 *
 * Nunca lança: falha na leitura vira tudo "não classificado" (é um detalhe da
 * tela, não pode derrubar a agenda).
 */
export async function loadAppointmentOriginHours(
  tenantId: string,
  appointments: { id: string; conversationId: string | null; leadId: string | null; createdAt: Date }[],
): Promise<Map<string, OriginHours>> {
  const result = new Map<string, OriginHours>(appointments.map((a) => [a.id, "unclassified"]));
  if (!appointments.length) return result;
  try {
    const report = await prisma.monthlyRoiReport.findFirst({
      where: { tenantId }, orderBy: { month: "desc" }, select: { assumptions: true },
    });
    const config = parseMonthlyAssumptions(report?.assumptions ?? null);
    if (!config.humanHours) return result;

    // Sem conversa gravada (marcação manual com contato), vale a primeira
    // chegada do contato em qualquer conversa real dele.
    const leadIds = [...new Set(appointments.filter((a) => !a.conversationId && a.leadId).map((a) => a.leadId!))];
    const conversationIds = [...new Set(appointments.map((a) => a.conversationId).filter((id): id is string => Boolean(id)))];
    const firsts = await prisma.message.groupBy({
      by: ["conversationId"],
      where: {
        role: "user",
        conversation: {
          tenantId, isTest: false,
          OR: [{ id: { in: conversationIds } }, { leadId: { in: leadIds } }],
        },
      },
      _min: { createdAt: true },
    });
    const byConversation = new Map(firsts.map((f) => [f.conversationId, f._min.createdAt]));
    const leadOf = leadIds.length
      ? await prisma.conversation.findMany({ where: { tenantId, leadId: { in: leadIds }, isTest: false }, select: { id: true, leadId: true } })
      : [];
    const byLead = new Map<string, Date>();
    for (const c of leadOf) {
      const at = byConversation.get(c.id);
      const current = byLead.get(c.leadId);
      if (at && (!current || at < current)) byLead.set(c.leadId, at);
    }

    const outside = (at: Date) => outsideHumanHours(at, config);
    for (const a of appointments) {
      const first = a.conversationId ? byConversation.get(a.conversationId) : a.leadId ? byLead.get(a.leadId) : null;
      result.set(a.id, originHours(first, a.createdAt, outside));
    }
  } catch (error) {
    console.error("[agenda] horário de origem indisponível", error);
  }
  return result;
}
