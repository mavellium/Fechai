import { prisma } from "@/lib/prisma";
import { dayKeyInZone, partsInZone, zonedTimeToUtc } from "@/modules/scheduling/time";
import { maskName, maskPhone, maskText } from "./mask";

export type GapStatus = "open" | "answered" | "dismissed";
export const GAP_STATUSES: GapStatus[] = ["open", "answered", "dismissed"];
export const parseGapStatus = (v: unknown): GapStatus =>
  v === "answered" || v === "dismissed" ? v : "open";

export type GapOccurrenceView = {
  id: string;
  conversationId: string;
  contactName: string;
  contactPhone: string;
  askedAt: Date;
  resumeStatus: string | null;
  resumeNote: string | null;
};

export type GapExcerptLine = { id: string; role: string; sentBy: string | null; content: string; at: Date };

export type GapView = {
  id: string;
  question: string;
  status: GapStatus;
  askedCount: number;
  firstAskedAt: Date;
  lastAskedAt: Date;
  agentName: string | null;
  draftAnswer: string | null;
  answer: string | null;
  answeredAt: Date | null;
  answerUpdatedAt: Date | null;
  answeredByLabel: string | null;
  answeredByRole: string | null;
  /** Contatos que ainda podem ser retomados com a resposta. */
  pendingResume: number;
  occurrences: GapOccurrenceView[];
  /** Trecho da conversa mais recente que perguntou, até a resposta do agente. */
  excerpt: GapExcerptLine[];
};

const OCCURRENCES_SHOWN = 8;
const EXCERPT_BEFORE = 5;
const EXCERPT_AFTER = 2;

/**
 * A fila de uma conta. `masked` é para quem não é da clínica (Mavellium,
 * personificação): nome e telefone viram iniciais e final do número, e o
 * texto da conversa passa por `maskText` com os nomes e números de TODOS os
 * contatos do grupo — a Maria pode ser citada na conversa do João.
 */
export async function listGaps(
  tenantId: string,
  status: GapStatus,
  options: { masked: boolean; take?: number },
): Promise<GapView[]> {
  const gaps = await prisma.knowledgeGap.findMany({
    where: { tenantId, status },
    orderBy: status === "open" ? [{ askedCount: "desc" }, { lastAskedAt: "desc" }] : [{ updatedAt: "desc" }],
    take: options.take ?? 40,
    select: {
      id: true, question: true, status: true, askedCount: true, firstAskedAt: true, lastAskedAt: true,
      draftAnswer: true, answer: true, answeredAt: true, answerUpdatedAt: true,
      answeredByLabel: true, answeredByRole: true,
      agent: { select: { name: true } },
      occurrences: {
        orderBy: { askedAt: "desc" },
        select: {
          id: true, conversationId: true, askedAt: true, messageId: true, question: true,
          resumeStatus: true, resumeNote: true,
          conversation: { select: { lead: { select: { name: true, phone: true } } } },
        },
      },
    },
  });

  return Promise.all(gaps.map(async (gap) => {
    const names = gap.occurrences.map((o) => o.conversation.lead.name);
    const phones = gap.occurrences.map((o) => o.conversation.lead.phone);
    const hide = (text: string) => (options.masked ? maskText(text, { names, phones }) : text);
    const latest = gap.occurrences[0];
    const excerpt = latest ? await loadExcerpt(tenantId, latest.conversationId, latest.messageId, latest.askedAt) : [];
    return {
      id: gap.id,
      question: hide(gap.question),
      status: gap.status as GapStatus,
      askedCount: gap.askedCount,
      firstAskedAt: gap.firstAskedAt,
      lastAskedAt: gap.lastAskedAt,
      agentName: gap.agent?.name ?? null,
      draftAnswer: gap.draftAnswer,
      answer: gap.answer,
      answeredAt: gap.answeredAt,
      answerUpdatedAt: gap.answerUpdatedAt,
      answeredByLabel: options.masked && gap.answeredByRole === "clinic" ? "equipe da clínica" : gap.answeredByLabel,
      answeredByRole: gap.answeredByRole,
      pendingResume: gap.occurrences.filter((o) => o.resumeStatus === null).length,
      occurrences: gap.occurrences.slice(0, OCCURRENCES_SHOWN).map((o) => ({
        id: o.id,
        conversationId: o.conversationId,
        contactName: options.masked ? maskName(o.conversation.lead.name) : o.conversation.lead.name?.trim() || "Sem nome",
        contactPhone: options.masked ? maskPhone(o.conversation.lead.phone) : o.conversation.lead.phone,
        askedAt: o.askedAt,
        resumeStatus: o.resumeStatus,
        resumeNote: o.resumeNote,
      })),
      excerpt: excerpt.map((line) => ({ ...line, content: hide(line.content) })),
    };
  }));
}

/**
 * Algumas falas antes da pergunta e a resposta que o agente deu logo depois —
 * é ela que mostra à equipe se o agente segurou a regra de não inventar.
 */
async function loadExcerpt(tenantId: string, conversationId: string, messageId: string | null, askedAt: Date) {
  const anchor = messageId
    ? await prisma.message.findFirst({
        where: { id: messageId, conversationId, conversation: { tenantId } },
        select: { createdAt: true },
      })
    : null;
  const pivot = anchor?.createdAt ?? askedAt;
  const select = { id: true, role: true, sentBy: true, content: true, createdAt: true } as const;
  const where = { conversationId, conversation: { tenantId }, role: { in: ["user", "assistant"] } };
  const [before, after] = await Promise.all([
    prisma.message.findMany({ where: { ...where, createdAt: { lte: pivot } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: EXCERPT_BEFORE, select }),
    prisma.message.findMany({ where: { ...where, createdAt: { gt: pivot } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: EXCERPT_AFTER, select }),
  ]);
  return [...before.reverse(), ...after].map((m) => ({
    id: m.id, role: m.role, sentBy: m.sentBy, content: m.content.slice(0, 600), at: m.createdAt,
  }));
}

export async function countGaps(tenantId: string): Promise<Record<GapStatus, number>> {
  const rows = await prisma.knowledgeGap.groupBy({ by: ["status"], where: { tenantId }, _count: { _all: true } });
  const counts: Record<GapStatus, number> = { open: 0, answered: 0, dismissed: 0 };
  for (const row of rows) if (row.status in counts) counts[row.status as GapStatus] = row._count._all;
  return counts;
}

export type GapStats = {
  open: number;
  /** Tempo médio entre a primeira vez que perguntaram e a aprovação, nos últimos 30 dias. */
  avgAnswerSeconds: number | null;
  answered30d: number;
  /**
   * Perguntas sem resposta por mês (seis meses, o atual por último). Mesma
   * fonte do relatório mensal (`ReportEvent` "unanswered"): a tela e o PDF
   * não podem dar números diferentes para o mesmo mês.
   */
  months: { key: string; label: string; count: number }[];
};

export async function gapStats(tenantId: string, timezone: string, now = new Date()): Promise<GapStats> {
  const p = partsInZone(now, timezone);
  const firstMonth = new Date(Date.UTC(p.year, p.month - 1 - 5, 1));
  const since = zonedTimeToUtc(firstMonth.getUTCFullYear(), firstMonth.getUTCMonth() + 1, 1, 0, 0, timezone);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);

  const [open, answered, events] = await Promise.all([
    prisma.knowledgeGap.count({ where: { tenantId, status: "open" } }),
    prisma.knowledgeGap.findMany({
      where: { tenantId, answeredAt: { gte: thirtyDaysAgo } },
      select: { firstAskedAt: true, answeredAt: true },
    }),
    prisma.reportEvent.findMany({
      where: { tenantId, kind: "unanswered", createdAt: { gte: since }, conversation: { isTest: false, lead: { isTest: false } } },
      select: { createdAt: true },
    }),
  ]);

  const durations = answered.map((g) => (g.answeredAt!.getTime() - g.firstAskedAt.getTime()) / 1000);
  const byMonth = new Map<string, number>();
  for (const e of events) {
    const key = dayKeyInZone(e.createdAt, timezone).slice(0, 7);
    byMonth.set(key, (byMonth.get(key) ?? 0) + 1);
  }
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(Date.UTC(p.year, p.month - 1 - 5 + i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const label = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" }).format(d).replace(".", "");
    return { key, label, count: byMonth.get(key) ?? 0 };
  });

  return {
    open,
    avgAnswerSeconds: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
    answered30d: answered.length,
    months,
  };
}
