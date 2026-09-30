import { prisma } from "@/lib/prisma";
import { getServiceArea } from "./service-area-store";
import { classifyCity } from "./service-area";
import { leadOutcome, summarizeLeadQuality, type LeadQuality, type LeadRow } from "./summary";
import type { LeadEvidence } from "@/modules/reports/monthly-evidence";

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
  return (await loadLeadQualityDetail(tenantId, range, options)).quality;
}

/**
 * O mesmo agregado e, lead a lead, o que o compôs — para o relatório mensal
 * abrir "273 leads" nos 273 registros. Identificador, datas, cidade e as
 * classificações; nada de nome, telefone ou texto de conversa.
 */
export async function loadLeadQualityDetail(
  tenantId: string,
  range: { from: Date | null; to: Date },
  options: { agentIds?: string[]; now?: Date } = {},
): Promise<{ quality: LeadQuality; leads: LeadEvidence[] }> {
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
        id: true, createdAt: true, status: true, disqualifiedAt: true, disqualifiedReason: true,
        appointments: { select: { status: true } },
        conversation: {
          select: {
            id: true, needsHuman: true, lastInboundAt: true, followUpReason: true,
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
  const now = options.now ?? new Date();
  const detail: LeadEvidence[] = rows.map((row, i) => {
    const { outcome, lossKey } = leadOutcome(row, now);
    const cityKey = row.insight?.cityKey ?? null;
    return { leadId: leads[i].id, conversationId: leads[i].conversation?.id ?? null, createdAt: row.createdAt.toISOString(),
      city: row.insight?.city ?? null, verdict: cityKey ? classifyCity(area, cityKey) : null,
      outcome, lossKey, doubtKey: row.insight?.firstQuestionKey ?? null };
  });
  return { quality: summarizeLeadQuality(rows, area, now), leads: detail };
}
