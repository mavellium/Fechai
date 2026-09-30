import { prisma } from "@/lib/prisma";
import { getServiceArea } from "./service-area-store";
import { summarizeLeadQuality, type LeadQuality, type LeadRow } from "./summary";

/** Teto de leads lidos por consulta: janela "tudo" de conta grande não pode varrer a tabela inteira. */
const MAX_LEADS = 20_000;

/**
 * Lê os leads reais criados na janela [from, to) e agrega. `from: null` é desde
 * o início da conta. `agentIds` restringe às conversas desses agentes (o escopo
 * do relatório mensal). Só metadados: nenhum nome, telefone ou texto de
 * conversa sai daqui — o painel e o relatório mostram agregados.
 */
export async function loadLeadQuality(
  tenantId: string,
  range: { from: Date | null; to: Date },
  options: { agentIds?: string[]; now?: Date } = {},
): Promise<LeadQuality> {
  const [area, leads] = await Promise.all([
    getServiceArea(tenantId),
    prisma.lead.findMany({
      where: {
        tenantId,
        isTest: false,
        createdAt: { ...(range.from ? { gte: range.from } : {}), lt: range.to },
        ...(options.agentIds?.length ? { conversation: { agentId: { in: options.agentIds } } } : {}),
      },
      select: {
        createdAt: true, status: true, disqualifiedAt: true, disqualifiedReason: true,
        appointments: { select: { status: true } },
        conversation: {
          select: {
            needsHuman: true, lastInboundAt: true, followUpReason: true,
            reportEvents: { where: { kind: "handoff" }, select: { id: true }, take: 1 },
            insight: { select: { city: true, cityKey: true, firstQuestionKey: true, lossReasonKey: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: MAX_LEADS,
    }),
  ]);

  const rows: LeadRow[] = leads.map((lead) => ({
    createdAt: lead.createdAt,
    status: lead.status,
    disqualified: lead.disqualifiedAt !== null,
    disqualifiedReason: lead.disqualifiedReason,
    appointments: lead.appointments,
    conversation: lead.conversation && {
      needsHuman: lead.conversation.needsHuman,
      lastInboundAt: lead.conversation.lastInboundAt,
      followUpReason: lead.conversation.followUpReason,
      handoffEvents: lead.conversation.reportEvents.length,
    },
    insight: lead.conversation?.insight ?? null,
  }));
  return summarizeLeadQuality(rows, area, options.now ?? new Date());
}
