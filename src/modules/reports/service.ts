import { prisma } from "@/lib/prisma";
import { dateLabel } from "@/lib/format";
import { planOf } from "@/modules/billing/plans";
import { partsInZone, zonedTimeToUtc } from "@/modules/scheduling/time";

/**
 * Fuso do painel para todo agrupamento por dia/hora/mês de /relatorios. Sem
 * isto os buckets usavam hora do servidor — em produção (UTC) "hoje" começava
 * às 21h da véspera em Brasília. Mesmo fuso de `src/lib/format.ts`.
 */
const PANEL_TIME_ZONE = "America/Sao_Paulo";

export type TenantReport = {
  conversations: number;
  leads: number;
  hotLeads: number;
  scheduled: number;
  needsHuman: number;
  followUpsSent: number;
  responseRate: number; // 0..1 — conversas em que o lead respondeu ao menos 1x após o início
};

/**
 * Métricas do tenant. Sempre filtrado por tenantId — e por `isTest: false`.
 *
 * O chat de teste criava lead e conversa como qualquer canal, então três
 * mensagens experimentando a persona viravam "1 lead, 1 conversa" no relatório
 * que a pessoa usa para decidir se o produto está funcionando.
 */
export async function computeTenantReport(tenantId: string): Promise<TenantReport> {
  const [conversations, leads, hotLeads, scheduled, needsHuman, followUpsSent, userMsgGroups] =
    await Promise.all([
      prisma.conversation.count({ where: { tenantId, isTest: false } }),
      prisma.lead.count({ where: { tenantId, isTest: false } }),
      prisma.lead.count({ where: { tenantId, isTest: false, status: "hot" } }),
      prisma.lead.count({ where: { tenantId, isTest: false, status: "scheduled" } }),
      prisma.conversation.count({ where: { tenantId, isTest: false, needsHuman: true } }),
      prisma.conversation.count({
        where: { tenantId, isTest: false, followUpSentAt: { not: null } },
      }),
      // mensagens do lead agrupadas por conversa → "engajada" = 2+ mensagens dele
      prisma.message.groupBy({
        by: ["conversationId"],
        where: { role: "user", conversation: { tenantId, isTest: false } },
        _count: { _all: true },
      }),
    ]);

  const engaged = userMsgGroups.filter((g) => g._count._all >= 2).length;
  const responseRate = conversations > 0 ? engaged / conversations : 0;

  return { conversations, leads, hotLeads, scheduled, needsHuman, followUpsSent, responseRate };
}

export type HomeSummary = {
  days: number;
  /** Conversas com atividade no período (Conversation não tem `createdAt`). */
  activeConversations: number;
  newLeads: number;
  hotLeads: number;
  needsHuman: number;
  /** Variação contra a janela imediatamente anterior, do mesmo tamanho. */
  deltaConversations: number;
  deltaLeads: number;
  /** Uma posição por dia do período, da mais antiga para a mais recente. */
  inboundByDay: { day: Date; count: number }[];
};

const DAY_MS = 86_400_000;

/** Meia-noite (fuso do painel) do dia que contém `d`, como instante UTC. */
function startOfDay(d: Date) {
  const p = partsInZone(d, PANEL_TIME_ZONE);
  return zonedTimeToUtc(p.year, p.month, p.day, 0, 0, PANEL_TIME_ZONE);
}

/**
 * Resumo do período para a home.
 *
 * `computeTenantReport` responde "desde o início da conta", que é o que
 * /relatorios precisa — mas não responde a pergunta de quem abre o painel de
 * manhã ("como foi desde ontem?"). Daí uma função separada, com janela e
 * comparação contra o período anterior.
 */
export async function computeHomeSummary(tenantId: string, days: number): Promise<HomeSummary> {
  const now = new Date();
  const since = new Date(startOfDay(now).getTime() - (days - 1) * DAY_MS);
  const prevSince = new Date(since.getTime() - days * DAY_MS);

  const [activeConversations, prevConversations, newLeads, prevLeads, hotLeads, needsHuman, inbound] =
    await Promise.all([
      prisma.conversation.count({ where: { tenantId, isTest: false, updatedAt: { gte: since } } }),
      prisma.conversation.count({
        where: { tenantId, isTest: false, updatedAt: { gte: prevSince, lt: since } },
      }),
      prisma.lead.count({ where: { tenantId, isTest: false, createdAt: { gte: since } } }),
      prisma.lead.count({
        where: { tenantId, isTest: false, createdAt: { gte: prevSince, lt: since } },
      }),
      prisma.lead.count({ where: { tenantId, isTest: false, status: "hot" } }),
      prisma.conversation.count({ where: { tenantId, isTest: false, needsHuman: true } }),
      // Agrupar por dia no banco exigiria SQL cru (`date_trunc`) e amarraria o
      // relatório ao Postgres. Na janela máxima daqui (30 dias de mensagens de
      // uma conta), trazer só os timestamps e contar em memória é barato.
      prisma.message.findMany({
        where: {
          role: "user",
          createdAt: { gte: since },
          conversation: { tenantId, isTest: false },
        },
        select: { createdAt: true },
      }),
    ]);

  const buckets = new Map<number, number>();
  for (let i = 0; i < days; i++) {
    buckets.set(since.getTime() + i * DAY_MS, 0);
  }
  for (const m of inbound) {
    const key = startOfDay(m.createdAt).getTime();
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  return {
    days,
    activeConversations,
    newLeads,
    hotLeads,
    needsHuman,
    deltaConversations: activeConversations - prevConversations,
    deltaLeads: newLeads - prevLeads,
    inboundByDay: [...buckets].map(([time, count]) => ({ day: new Date(time), count })),
  };
}

// ── Relatório por período (gráficos + deltas) ─────────────────────────────────

export type PeriodKey = "hoje" | "7" | "30" | "mes" | "ano" | "tudo";

export type BucketUnit = "hora" | "dia" | "mes";

/** Janela resolvida a partir do filtro da URL (`?periodo=` ou `?de=&ate=`). */
export type ReportRange = {
  /** null = desde o início da conta. */
  from: Date | null;
  to: Date;
  /** Texto para a descrição da página ("nos últimos 30 dias"). */
  label: string;
  /** Granularidade dos gráficos: hoje vira hora; janelas curtas, dia; longas, mês. */
  bucket: BucketUnit;
  /** Janela imediatamente anterior, do mesmo tamanho — para os deltas. */
  prevFrom: Date | null;
  prevTo: Date | null;
};

/** Uma coluna do gráfico de fluxo: mensagens recebidas × enviadas. */
export type FlowPoint = { key: string; label: string; inbound: number; outbound: number };

/** Uma coluna do gráfico de resultados: leads novos × agendamentos. */
export type ResultPoint = { key: string; label: string; leads: number; appts: number };

/**
 * Uma coluna de uma comparação IA × humano: contatos atendidos só pela IA
 * contra os que precisaram de um humano (`attendance`), ou agendamentos
 * fechados pela IA contra os marcados manualmente (`closed`).
 */
export type AiHumanPoint = { key: string; label: string; ai: number; human: number };

export type PeriodKpis = {
  conversations: number;
  leads: number;
  scheduled: number;
  inbound: number;
  outbound: number;
  responseRate: number;
  /** Estado atual, não do período (o status não tem histórico). */
  hotLeads: number;
  needsHuman: number;
  prev: {
    conversations: number;
    leads: number;
    scheduled: number;
    inbound: number;
    outbound: number;
    responseRate: number;
  } | null;
};

/** Um degrau do funil de conversão — nome + contagem, na ordem em que aparecem. */
export type FunnelStep = { name: string; count: number };

/** Uma célula do heatmap de horário de pico: dia da semana (0=dom) × hora (0-23). */
export type HeatmapCell = { weekday: number; hour: number; count: number };

/** Uma faixa de tempo até a primeira resposta, com a contagem em cada uma. */
export type ResponseTimeBucket = { label: string; ai: number; human: number };

/** Uma coluna do gráfico de comparecimento: concluídos × cancelados. */
export type AttendanceOutcomePoint = { key: string; label: string; done: number; canceled: number };

export type PeriodReport = {
  kpis: PeriodKpis;
  flow: FlowPoint[];
  results: ResultPoint[];
  byAgent: { name: string; count: number }[];
  byStatus: { status: string; count: number }[];
  /** Contatos atendidos só pela IA × contatos em que um humano respondeu. */
  attendance: AiHumanPoint[];
  /** Agendamentos fechados pela IA (`source: agent`) × manuais (`source: manual`), só scheduled/done. */
  closed: AiHumanPoint[];
  /** Conversas → leads engajados → leads quentes → agendados, todos CRIADOS no período. */
  funnel: FunnelStep[];
  /** Mensagens recebidas do lead, por dia da semana × hora (fuso do painel). */
  peakHours: HeatmapCell[];
  /** Tempo entre a mensagem do lead e a primeira resposta seguinte, por faixa. */
  firstResponseTime: ResponseTimeBucket[];
  /** Resolução autônoma: fração de contatos que a IA atendeu sozinha no período. */
  autonomyRate: { current: number; previous: number | null };
  /** Follow-ups enviados no período e quantos tiveram resposta do lead depois. */
  followUpRecovery: { sent: number; recovered: number };
  /** Agendamentos concluídos × cancelados, por bucket (base: `createdAt`). */
  attendanceOutcome: AttendanceOutcomePoint[];
};

const HOUR_MS = 3_600_000;
const MONTH_LABEL = new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit", timeZone: PANEL_TIME_ZONE });
const DAY_LABEL = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: PANEL_TIME_ZONE });
const HOUR_LABEL = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", hourCycle: "h23", timeZone: PANEL_TIME_ZONE });

/** Início (dia 1, meia-noite) do mês do painel que contém `d`, como instante UTC. */
function startOfMonth(d: Date) {
  const p = partsInZone(d, PANEL_TIME_ZONE);
  return zonedTimeToUtc(p.year, p.month, 1, 0, 0, PANEL_TIME_ZONE);
}

function addMonths(d: Date, n: number) {
  const p = partsInZone(d, PANEL_TIME_ZONE);
  const total = p.month - 1 + n;
  const year = p.year + Math.floor(total / 12);
  const month = (((total % 12) + 12) % 12) + 1;
  return zonedTimeToUtc(year, month, 1, 0, 0, PANEL_TIME_ZONE);
}

/** "YYYY-MM-DD" da URL → meia-noite desse dia no fuso do painel, ou null se malformado. */
function parseDate(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const date = zonedTimeToUtc(y, m, d, 0, 0, PANEL_TIME_ZONE);
  const p = partsInZone(date, PANEL_TIME_ZONE);
  if (p.year !== y || p.month !== m || p.day !== d) return null;
  return date;
}

function bucketUnitFor(from: Date, to: Date): BucketUnit {
  const ms = to.getTime() - from.getTime();
  if (ms <= DAY_MS) return "hora";
  if (ms <= 62 * DAY_MS) return "dia";
  return "mes";
}

/**
 * Resolve a janela a partir da querystring. `de`/`ate` (intervalo personalizado)
 * têm prioridade sobre `periodo`; sem `de`, os presets decidem.
 */
export function resolveRange(period: PeriodKey, de?: string, ate?: string): ReportRange {
  const now = new Date();

  let from: Date | null;
  let to = now;

  const customFrom = de ? parseDate(de) : null;
  const customTo = ate ? parseDate(ate) : null;
  if (customFrom) {
    from = customFrom;
    // customTo já é meia-noite (fuso do painel) do dia final; some quase um dia
    // inteiro para cobrir até 23:59:59.999 desse dia, sem repetir o cálculo de fuso.
    to = customTo ? new Date(customTo.getTime() + DAY_MS - 1) : now;
    if (to > now) to = now;
    if (from > now) from = startOfDay(now);
    if (to < from) to = from;
  } else {
    switch (period) {
      case "hoje":
        from = startOfDay(now);
        break;
      case "7":
        from = new Date(startOfDay(now).getTime() - 6 * DAY_MS);
        break;
      case "30":
        from = new Date(startOfDay(now).getTime() - 29 * DAY_MS);
        break;
      case "mes":
        from = startOfMonth(now);
        break;
      case "ano": {
        const p = partsInZone(now, PANEL_TIME_ZONE);
        from = zonedTimeToUtc(p.year, 1, 1, 0, 0, PANEL_TIME_ZONE);
        break;
      }
      case "tudo":
        from = null;
        break;
    }
  }

  const length = from ? to.getTime() - from.getTime() : 0;
  const prevTo = from ? new Date(from.getTime() - 1) : null;
  const prevFrom = prevTo ? new Date(prevTo.getTime() - length) : null;

  const bucket = from ? bucketUnitFor(from, to) : "mes";

  const label = customFrom
    ? ate && customTo
      ? `de ${dateLabel(customFrom)} a ${dateLabel(customTo)}`
      : `desde ${dateLabel(customFrom)}`
    : ({
        hoje: "atividade de hoje",
        "7": "atividade nos últimos 7 dias",
        "30": "atividade nos últimos 30 dias",
        mes: "atividade neste mês",
        ano: "atividade neste ano",
        tudo: "toda a atividade desde o início da conta",
      } as const)[period];

  return { from, to, label, bucket, prevFrom, prevTo };
}

function bucketStart(ts: Date, unit: BucketUnit) {
  if (unit === "hora") {
    const p = partsInZone(ts, PANEL_TIME_ZONE);
    return zonedTimeToUtc(p.year, p.month, p.day, p.hour, 0, PANEL_TIME_ZONE);
  }
  if (unit === "dia") return startOfDay(ts);
  return startOfMonth(ts);
}

function bucketStep(current: Date, unit: BucketUnit) {
  if (unit === "hora") return new Date(current.getTime() + HOUR_MS);
  if (unit === "dia") return new Date(current.getTime() + DAY_MS);
  return addMonths(current, 1);
}

function bucketLabel(ts: Date, unit: BucketUnit) {
  if (unit === "hora") return `${HOUR_LABEL.format(ts)}h`;
  if (unit === "dia") return DAY_LABEL.format(ts);
  return MONTH_LABEL.format(ts);
}

/** Lista todos os buckets entre `from` e `to` (inclusive), em ordem. */
function listBuckets(from: Date, to: Date, unit: BucketUnit) {
  const out: { key: string; label: string }[] = [];
  let cursor = bucketStart(from, unit);
  const end = to.getTime();
  // trava de segurança: janela anormalmente longa não vira mapa de 10 mil pontos
  for (let i = 0; i < 400 && cursor.getTime() <= end; i++) {
    out.push({ key: cursor.toISOString(), label: bucketLabel(cursor, unit) });
    cursor = bucketStep(cursor, unit);
  }
  return out;
}

/**
 * KPI + séries do período. Consultas semelhantes às da home, mas com janela
 * configurável e agregação por bucket em memória (mesmo custo da sparkline,
 * ainda barato na escala de uma conta).
 */
export async function computePeriodReport(tenantId: string, range: ReportRange): Promise<PeriodReport> {
  const { from, to, bucket, prevFrom, prevTo } = range;
  const toExcl = new Date(to.getTime() + 1);
  const prevLt = prevTo ? new Date(prevTo.getTime() + 1) : undefined;

  const [
    conversations,
    leads,
    scheduled,
    messages,
    leadRows,
    apptRows,
    engagedGroups,
    agentGroups,
    statusGroups,
    hotLeads,
    needsHuman,
    assistantMsgs,
    closedAppts,
    canceledAppts,
    doneAppts,
    hotLeadsInPeriod,
    orderedMsgs,
    followUpConvos,
  ] = await Promise.all([
    prisma.conversation.count({
      where: { tenantId, isTest: false, updatedAt: { gte: from ?? undefined, lt: toExcl } },
    }),
    prisma.lead.count({
      where: { tenantId, isTest: false, createdAt: { gte: from ?? undefined, lt: toExcl } },
    }),
    prisma.appointment.count({
      where: {
        tenantId,
        startsAt: { gte: from ?? undefined, lt: toExcl },
        status: { in: ["scheduled", "done"] },
      },
    }),
    prisma.message.findMany({
      where: {
        role: { in: ["user", "assistant"] },
        createdAt: { gte: from ?? undefined, lt: toExcl },
        conversation: { tenantId, isTest: false },
      },
      select: { role: true, createdAt: true },
    }),
    prisma.lead.findMany({
      where: { tenantId, isTest: false, createdAt: { gte: from ?? undefined, lt: toExcl } },
      select: { createdAt: true },
    }),
    prisma.appointment.findMany({
      where: {
        tenantId,
        startsAt: { gte: from ?? undefined, lt: toExcl },
        status: { in: ["scheduled", "done"] },
      },
      select: { startsAt: true },
    }),
    prisma.message.groupBy({
      by: ["conversationId"],
      where: {
        role: "user",
        createdAt: { gte: from ?? undefined, lt: toExcl },
        conversation: { tenantId, isTest: false },
      },
      _count: { _all: true },
    }),
    prisma.conversation.groupBy({
      by: ["agentId"],
      where: { tenantId, isTest: false, updatedAt: { gte: from ?? undefined, lt: toExcl } },
      _count: { _all: true },
    }),
    prisma.lead.groupBy({
      by: ["status"],
      where: { tenantId, isTest: false, createdAt: { gte: from ?? undefined, lt: toExcl } },
      _count: { _all: true },
    }),
    prisma.lead.count({ where: { tenantId, isTest: false, status: "hot" } }),
    prisma.conversation.count({ where: { tenantId, isTest: false, needsHuman: true } }),
    // Respostas assistant com quem gerou — base dos gráficos "IA × humano".
    prisma.message.findMany({
      where: {
        role: "assistant",
        sentBy: { in: ["agent", "human"] },
        createdAt: { gte: from ?? undefined, lt: toExcl },
        conversation: { tenantId, isTest: false },
      },
      select: { sentBy: true, createdAt: true, conversationId: true },
    }),
    // Agendamentos EFETIVADOS criados no período, com origem (IA vs manual).
    // Alinhado ao KPI "Agendamentos" (só scheduled/done) — antes contava
    // cancelado como "lead fechado", divergindo do número que a mesma tela
    // mostra ao lado. Mudança de definição registrada no CHANGELOG.
    prisma.appointment.findMany({
      where: {
        tenantId,
        createdAt: { gte: from ?? undefined, lt: toExcl },
        status: { in: ["scheduled", "done"] },
      },
      select: { source: true, createdAt: true },
    }),
    // Agendamentos cancelados no período — base do gráfico de comparecimento.
    prisma.appointment.findMany({
      where: {
        tenantId,
        createdAt: { gte: from ?? undefined, lt: toExcl },
        status: "canceled",
      },
      select: { createdAt: true },
    }),
    // Agendamentos concluídos no período — a outra metade do comparecimento.
    prisma.appointment.findMany({
      where: {
        tenantId,
        createdAt: { gte: from ?? undefined, lt: toExcl },
        status: "done",
      },
      select: { createdAt: true },
    }),
    // Funil: leads com 2+ mensagens do lead (engajados) já vem de engagedGroups;
    // aqui só o total de leads quentes/agendados CRIADOS no período (o funil é
    // sobre o que entrou nesta janela, não o estado atual da conta inteira).
    prisma.lead.count({
      where: { tenantId, isTest: false, createdAt: { gte: from ?? undefined, lt: toExcl }, status: "hot" },
    }),
    // Primeira mensagem do lead e primeira resposta de cada conversa tocada no
    // período — base do "tempo até a primeira resposta". Ordenado para achar o
    // par (1ª pergunta, 1ª resposta seguinte) em memória, sem N+1 por conversa.
    prisma.message.findMany({
      where: {
        role: { in: ["user", "assistant"] },
        createdAt: { gte: from ?? undefined, lt: toExcl },
        conversation: { tenantId, isTest: false },
      },
      select: { conversationId: true, role: true, sentBy: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    // Conversas com follow-up enviado no período — base da "recuperação por follow-up".
    prisma.conversation.findMany({
      where: { tenantId, isTest: false, followUpSentAt: { gte: from ?? undefined, lt: toExcl } },
      select: { id: true, followUpSentAt: true },
    }),
  ]);

  // ── período anterior (mesma janela de tempo imediatamente antes) ───────────
  let prev: PeriodKpis["prev"] = null;
  if (prevFrom && prevLt) {
    const [prevConversations, prevLeads, prevScheduled, prevCounts, prevEngaged] = await Promise.all([
      prisma.conversation.count({
        where: { tenantId, isTest: false, updatedAt: { gte: prevFrom, lt: prevLt } },
      }),
      prisma.lead.count({
        where: { tenantId, isTest: false, createdAt: { gte: prevFrom, lt: prevLt } },
      }),
      prisma.appointment.count({
        where: { tenantId, startsAt: { gte: prevFrom, lt: prevLt }, status: { in: ["scheduled", "done"] } },
      }),
      prisma.message.groupBy({
        by: ["role"],
        where: {
          role: { in: ["user", "assistant"] },
          createdAt: { gte: prevFrom, lt: prevLt },
          conversation: { tenantId, isTest: false },
        },
        _count: { _all: true },
      }),
      prisma.message.groupBy({
        by: ["conversationId"],
        where: {
          role: "user",
          createdAt: { gte: prevFrom, lt: prevLt },
          conversation: { tenantId, isTest: false },
        },
        _count: { _all: true },
      }),
    ]);
    const counts = Object.fromEntries(prevCounts.map((c) => [c.role, c._count._all]));
    prev = {
      conversations: prevConversations,
      leads: prevLeads,
      scheduled: prevScheduled,
      inbound: counts.user ?? 0,
      outbound: counts.assistant ?? 0,
      responseRate: prevConversations > 0 ? prevEngaged.filter((g) => g._count._all >= 2).length / prevConversations : 0,
    };
  }

  // Resolução autônoma do período anterior — só o delta do meter, não precisa
  // do bucket por bucket que `attendance` calcula (o mesmo set exclusivo por
  // conversa, mas somado na janela inteira de uma vez).
  let previousAutonomy: number | null = null;
  if (prevFrom && prevLt) {
    const prevAssistantMsgs = await prisma.message.findMany({
      where: {
        role: "assistant",
        sentBy: { in: ["agent", "human"] },
        createdAt: { gte: prevFrom, lt: prevLt },
        conversation: { tenantId, isTest: false },
      },
      select: { sentBy: true, conversationId: true },
    });
    const aiSet = new Set<string>();
    const humanSet = new Set<string>();
    for (const m of prevAssistantMsgs) (m.sentBy === "agent" ? aiSet : humanSet).add(m.conversationId);
    const aiOnly = Math.max(0, aiSet.size - humanSet.size);
    const totalPrev = aiOnly + humanSet.size;
    previousAutonomy = totalPrev > 0 ? aiOnly / totalPrev : null;
  }

  // ── agregação por bucket ───────────────────────────────────────────────────
  // "tudo" não tem `from`; o gráfico começa na primeira mensagem da conta.
  const flowFrom = from ?? messages.reduce<Date | null>((a, m) => (a && a <= m.createdAt ? a : m.createdAt), null) ?? to;
  const buckets = listBuckets(flowFrom, to, bucket);

  const flowMap = new Map(buckets.map((b) => [b.key, { inbound: 0, outbound: 0 }]));
  for (const m of messages) {
    const slot = flowMap.get(bucketStart(m.createdAt, bucket).toISOString());
    if (!slot) continue;
    if (m.role === "user") slot.inbound++;
    else slot.outbound++;
  }

  const resultsMap = new Map(buckets.map((b) => [b.key, { leads: 0, appts: 0 }]));
  for (const l of leadRows) {
    const slot = resultsMap.get(bucketStart(l.createdAt, bucket).toISOString());
    if (slot) slot.leads++;
  }
  for (const a of apptRows) {
    const slot = resultsMap.get(bucketStart(a.startsAt, bucket).toISOString());
    if (slot) slot.appts++;
  }

  const flow: FlowPoint[] = buckets.map((b) => ({ ...b, ...flowMap.get(b.key)! }));
  const results: ResultPoint[] = buckets.map((b) => ({ ...b, ...resultsMap.get(b.key)! }));

  // ── comparações IA × humano ────────────────────────────────────────────────
  // "Só IA" é exclusivo por bucket: um contato com resposta automática E manual
  // no mesmo bucket entra só em "humano" — a relação mostra quantos a IA
  // atendeu sozinha contra quantos precisaram de uma pessoa.
  const attendanceMap = new Map(buckets.map((b) => [b.key, { ai: 0, human: 0 }]));
  const byBucket = new Map<string, { ai: Set<string>; human: Set<string> }>();
  for (const m of assistantMsgs) {
    const key = bucketStart(m.createdAt, bucket).toISOString();
    if (!attendanceMap.has(key)) continue;
    let sets = byBucket.get(key);
    if (!sets) {
      sets = { ai: new Set<string>(), human: new Set<string>() };
      byBucket.set(key, sets);
    }
    (m.sentBy === "agent" ? sets.ai : sets.human).add(m.conversationId);
  }
  for (const [key, sets] of byBucket) {
    const human = sets.human.size;
    attendanceMap.set(key, { ai: Math.max(0, sets.ai.size - sets.human.size), human });
  }
  const attendance: AiHumanPoint[] = buckets.map((b) => ({ ...b, ...attendanceMap.get(b.key)! }));

  const closedMap = new Map(buckets.map((b) => [b.key, { ai: 0, human: 0 }]));
  for (const a of closedAppts) {
    const slot = closedMap.get(bucketStart(a.createdAt, bucket).toISOString());
    if (!slot) continue;
    if (a.source === "agent") slot.ai++;
    else slot.human++;
  }
  const closed: AiHumanPoint[] = buckets.map((b) => ({ ...b, ...closedMap.get(b.key)! }));

  // ── comparecimento: concluído × cancelado, por bucket ──────────────────────
  const outcomeMap = new Map(buckets.map((b) => [b.key, { done: 0, canceled: 0 }]));
  for (const a of doneAppts) {
    const slot = outcomeMap.get(bucketStart(a.createdAt, bucket).toISOString());
    if (slot) slot.done++;
  }
  for (const a of canceledAppts) {
    const slot = outcomeMap.get(bucketStart(a.createdAt, bucket).toISOString());
    if (slot) slot.canceled++;
  }
  const attendanceOutcome: AttendanceOutcomePoint[] = buckets.map((b) => ({ ...b, ...outcomeMap.get(b.key)! }));

  // ── funil de conversão (estado ATUAL de quem entrou no período — não há
  // histórico de transição de status, então "quente"/"agendado" são o status
  // de hoje dos leads criados na janela, não uma velocidade de funil) ────────
  const leadsCreated = leadRows.length;
  const engagedInPeriod = engagedGroups.filter((g) => g._count._all >= 2).length;
  const scheduledInPeriod = results.reduce((s, p) => s + p.appts, 0);
  const funnel: FunnelStep[] = [
    { name: "Conversas", count: conversations },
    { name: "Leads engajados", count: Math.min(engagedInPeriod, leadsCreated) },
    { name: "Leads quentes", count: hotLeadsInPeriod },
    { name: "Agendados", count: scheduledInPeriod },
  ];

  // ── horários de pico: mensagens do lead por dia da semana × hora ──────────
  const heatCounts = new Map<string, number>();
  for (const m of messages) {
    if (m.role !== "user") continue;
    const p = partsInZone(m.createdAt, PANEL_TIME_ZONE);
    const key = `${p.weekday}-${p.hour}`;
    heatCounts.set(key, (heatCounts.get(key) ?? 0) + 1);
  }
  const peakHours: HeatmapCell[] = [];
  for (let weekday = 0; weekday < 7; weekday++) {
    for (let hour = 0; hour < 24; hour++) {
      peakHours.push({ weekday, hour, count: heatCounts.get(`${weekday}-${hour}`) ?? 0 });
    }
  }

  // ── tempo até a primeira resposta (por conversa, o par 1ª pergunta → 1ª
  // resposta seguinte; `orderedMsgs` já chega ordenado por createdAt) ───────
  const RESPONSE_BUCKETS = [
    { label: "<1min", maxMs: 60_000 },
    { label: "1-5min", maxMs: 5 * 60_000 },
    { label: "5-30min", maxMs: 30 * 60_000 },
    { label: "30min-2h", maxMs: 2 * HOUR_MS },
    { label: "+2h", maxMs: Infinity },
  ];
  const firstResponseCounts = RESPONSE_BUCKETS.map((b) => ({ label: b.label, ai: 0, human: 0 }));
  const pendingQuestion = new Map<string, Date>();
  const answeredConversations = new Set<string>();
  for (const m of orderedMsgs) {
    if (m.role === "user") {
      if (!pendingQuestion.has(m.conversationId) && !answeredConversations.has(m.conversationId)) {
        pendingQuestion.set(m.conversationId, m.createdAt);
      }
      continue;
    }
    const askedAt = pendingQuestion.get(m.conversationId);
    if (!askedAt || answeredConversations.has(m.conversationId)) continue;
    const elapsedMs = m.createdAt.getTime() - askedAt.getTime();
    const idx = RESPONSE_BUCKETS.findIndex((b) => elapsedMs <= b.maxMs);
    const slot = firstResponseCounts[idx === -1 ? RESPONSE_BUCKETS.length - 1 : idx];
    if (m.sentBy === "human") slot.human++;
    else slot.ai++;
    answeredConversations.add(m.conversationId);
    pendingQuestion.delete(m.conversationId);
  }
  const firstResponseTime: ResponseTimeBucket[] = firstResponseCounts;

  // ── resolução autônoma: fração dos contatos atendidos que a IA resolveu
  // sozinha no período (mesma base de `attendance`, resumida num número) ────
  const totalAi = attendance.reduce((s, p) => s + p.ai, 0);
  const totalHuman = attendance.reduce((s, p) => s + p.human, 0);
  const currentAutonomy = totalAi + totalHuman > 0 ? totalAi / (totalAi + totalHuman) : 0;

  // ── recuperação por follow-up: dos enviados no período, quantos tiveram
  // resposta do lead depois do envio (mesma janela — consistente com o resto
  // do relatório, que não olha além do período selecionado) ─────────────────
  const followUpAt = new Map(followUpConvos.map((c) => [c.id, c.followUpSentAt!]));
  const recoveredConvos = new Set<string>();
  for (const m of orderedMsgs) {
    if (m.role !== "user") continue;
    const sentAt = followUpAt.get(m.conversationId);
    if (sentAt && m.createdAt > sentAt) recoveredConvos.add(m.conversationId);
  }
  const followUpRecovery = { sent: followUpConvos.length, recovered: recoveredConvos.size };

  // ── distribuições ──────────────────────────────────────────────────────────
  const agentIds = agentGroups.map((g) => g.agentId).filter(Boolean) as string[];
  const agents = agentIds.length
    ? await prisma.agent.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(agents.map((a) => [a.id, a.name]));
  const byAgent = agentGroups
    .map((g) => ({
      name: g.agentId ? (nameById.get(g.agentId) ?? "Agente removido") : "Sem agente",
      count: g._count._all,
    }))
    .sort((a, b) => b.count - a.count);
  const byStatus = statusGroups
    .map((g) => ({ status: g.status, count: g._count._all }))
    .sort((a, b) => b.count - a.count);

  const inbound = flow.reduce((s, p) => s + p.inbound, 0);
  const outbound = flow.reduce((s, p) => s + p.outbound, 0);
  const engaged = engagedGroups.filter((g) => g._count._all >= 2).length;

  return {
    kpis: {
      conversations,
      leads,
      scheduled,
      inbound,
      outbound,
      responseRate: conversations > 0 ? engaged / conversations : 0,
      hotLeads,
      needsHuman,
      prev,
    },
    flow,
    results,
    byAgent,
    byStatus,
    attendance,
    closed,
    funnel,
    peakHours,
    firstResponseTime,
    autonomyRate: { current: currentAutonomy, previous: previousAutonomy },
    followUpRecovery,
    attendanceOutcome,
  };
}

// ── Visão Financeira (retorno do investimento no projeto) ────────────────────

/** Um ponto do retorno acumulado × investido acumulado, um eixo só (R$). */
export type CumulativeReturnPoint = { key: string; label: string; returnCents: number; investedCents: number };

/** Retorno estimado por agente — barras horizontais. */
export type AgentReturnPoint = { name: string; returnCents: number; closedLeads: number };

/** Retorno − investido de um mês fechado (para o gráfico divergente). */
export type MonthlyReturnPoint = { key: string; label: string; netCents: number };

export type FinancialSummary = {
  /** Agendamentos EFETIVADOS (scheduled/done) criados no período — alinhado ao KPI "Agendamentos". */
  closedLeads: number;
  /** Meses de plano cobertos pela janela (mínimo 1; "hoje" conta 1). */
  months: number;
  /** Preço do plano atual × meses. */
  investedCents: number;
  planName: string;
  planPriceCents: number;
  /**
   * Valor por lead em vigor no início do período. `null` = o dono nunca
   * definiu. Um valor definido no MEIO de uma janela só passa a valer para as
   * janelas que começam depois — mudar o número não recalcula períodos passados.
   */
  valuePerLeadCents: number | null;
  /** Quando o valor em uso passou a valer (exibido no hint da UI). */
  valueStartsAt: Date | null;
  /** `closedLeads × valuePerLeadCents`; `null` enquanto não há valor definido. */
  returnCents: number | null;
  /** `(retorno − investido) / investido`; `null` se investido = 0 ou sem valor. */
  roiPercent: number | null;
  /** Retorno acumulado × investido acumulado por bucket. `null` sem valor por lead definido. */
  cumulative: CumulativeReturnPoint[] | null;
  /** Retorno estimado por agente, maiores primeiro. `null` sem valor por lead definido. */
  byAgent: AgentReturnPoint[] | null;
  /** Leads fechados necessários para cobrir o investido. `null` sem valor por lead definido. */
  breakEvenLeads: number | null;
  /** Retorno − investido, um ponto por mês de calendário tocado pela janela. `null` sem valor por lead. */
  monthly: MonthlyReturnPoint[] | null;
  /** `investedCents / closedLeads`. `null` sem fechamento no período. */
  costPerLeadCents: number | null;
};

/**
 * Retorno financeiro estimado do investimento no projeto. O "investido" é o
 * preço do plano atual × meses cobertos pela janela (o modelo não guarda
 * histórico de assinatura — o preço de hoje é a única fonte). O "retorno" é o
 * número de agendamentos do período × valor por lead. Só estimativa: o valor
 * por lead é subjetivo e o preço do plano presume o plano atual pelo período.
 */
export async function computeFinancialSummary(
  tenantId: string,
  range: ReportRange,
): Promise<FinancialSummary> {
  const toExcl = new Date(range.to.getTime() + 1);

  const [closedAppts, tenant, values] = await Promise.all([
    // Mesmo corte do gráfico "closed" do Operacional: só efetivados (scheduled/done).
    prisma.appointment.findMany({
      where: {
        tenantId,
        createdAt: { gte: range.from ?? undefined, lt: toExcl },
        status: { in: ["scheduled", "done"] },
      },
      select: { createdAt: true, agentId: true },
    }),
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { planKey: true, createdAt: true },
    }),
    prisma.tenantLeadValue.findMany({
      where: { tenantId },
      orderBy: { startsAt: "asc" },
      select: { valueCents: true, startsAt: true },
    }),
  ]);
  const closedLeads = closedAppts.length;

  const plan = planOf(tenant?.planKey);

  // "tudo" não tem `from`: ancora os meses na criação da conta.
  const anchor = range.from ?? tenant?.createdAt ?? range.to;
  const anchorParts = partsInZone(anchor, PANEL_TIME_ZONE);
  const toParts = partsInZone(range.to, PANEL_TIME_ZONE);
  const months = Math.max(
    1,
    (toParts.year - anchorParts.year) * 12 + (toParts.month - anchorParts.month) + 1,
  );
  const investedCents = plan.priceCents * months;

  let effective: { valueCents: number; startsAt: Date } | null = null;
  if (values.length > 0) {
    if (!range.from) {
      // "tudo": o valor mais recente (o atual) aplicado a todo o histórico.
      effective = values[values.length - 1];
    } else {
      const fromTs = range.from.getTime();
      let last = -1;
      for (let i = 0; i < values.length; i++) {
        if (values[i].startsAt.getTime() <= fromTs) last = i;
        else break;
      }
      // Sem valor em vigor no início (ex.: definido hoje, olhando "hoje"),
      // usa o primeiro existente — um lead fechado no período ainda é um lead.
      effective = last >= 0 ? values[last] : values[0];
    }
  }

  const valuePerLeadCents = effective?.valueCents ?? null;
  const returnCents = effective ? closedLeads * effective.valueCents : null;
  const roiPercent =
    returnCents !== null && investedCents > 0
      ? Math.round(((returnCents - investedCents) / investedCents) * 100)
      : null;

  // Sem valor por lead definido, nenhuma das séries abaixo é uma estimativa —
  // é um zero inventado. A UI mostra o estado vazio (chamada para definir o
  // valor), não um gráfico zerado (regra do plano, §"Caso sem valor definido").
  let cumulative: CumulativeReturnPoint[] | null = null;
  let byAgent: AgentReturnPoint[] | null = null;
  let breakEvenLeads: number | null = null;
  let monthly: MonthlyReturnPoint[] | null = null;

  if (effective) {
    const valueCents = effective.valueCents;

    // ── retorno acumulado × investido acumulado, por bucket do período ──────
    const cumFrom =
      range.from ?? closedAppts.reduce<Date | null>((a, ap) => (a && a <= ap.createdAt ? a : ap.createdAt), null) ?? range.to;
    const cumBuckets = listBuckets(cumFrom, range.to, range.bucket);
    const perBucketCount = new Map(cumBuckets.map((b) => [b.key, 0]));
    for (const ap of closedAppts) {
      const key = bucketStart(ap.createdAt, range.bucket).toISOString();
      if (perBucketCount.has(key)) perBucketCount.set(key, (perBucketCount.get(key) ?? 0) + 1);
    }
    // Investido distribuído em partes iguais pelos buckets do período — o
    // preço do plano é mensal, não por bucket, então divide o total de meses
    // proporcionalmente ao número de buckets (aproximação declarada "estimado").
    const investedPerBucket = cumBuckets.length > 0 ? investedCents / cumBuckets.length : 0;
    let runningReturn = 0;
    let runningInvested = 0;
    cumulative = cumBuckets.map((b) => {
      runningReturn += (perBucketCount.get(b.key) ?? 0) * valueCents;
      runningInvested += investedPerBucket;
      return { ...b, returnCents: runningReturn, investedCents: Math.round(runningInvested) };
    });

    // ── retorno por agente ────────────────────────────────────────────────
    const countByAgent = new Map<string | null, number>();
    for (const ap of closedAppts) {
      countByAgent.set(ap.agentId, (countByAgent.get(ap.agentId) ?? 0) + 1);
    }
    const agentIds = [...countByAgent.keys()].filter((id): id is string => id !== null);
    const agentRows = agentIds.length
      ? await prisma.agent.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true } })
      : [];
    const agentNameById = new Map(agentRows.map((a) => [a.id, a.name]));
    byAgent = [...countByAgent.entries()]
      .map(([agentId, count]) => ({
        name: agentId ? (agentNameById.get(agentId) ?? "Agente removido") : "Sem agente",
        returnCents: count * valueCents,
        closedLeads: count,
      }))
      .sort((a, b) => b.returnCents - a.returnCents);

    // ── ponto de equilíbrio ──────────────────────────────────────────────
    breakEvenLeads = valueCents > 0 ? Math.ceil(investedCents / valueCents) : null;

    // ── retorno mês a mês (lucro/prejuízo) ──────────────────────────────
    const monthFrom = range.from ?? tenant?.createdAt ?? range.to;
    const monthBuckets = listBuckets(monthFrom, range.to, "mes");
    const perMonthCount = new Map(monthBuckets.map((b) => [b.key, 0]));
    for (const ap of closedAppts) {
      const key = startOfMonth(ap.createdAt).toISOString();
      if (perMonthCount.has(key)) perMonthCount.set(key, (perMonthCount.get(key) ?? 0) + 1);
    }
    const investedPerMonth = monthBuckets.length > 0 ? investedCents / monthBuckets.length : 0;
    monthly = monthBuckets.map((b) => ({
      ...b,
      netCents: Math.round((perMonthCount.get(b.key) ?? 0) * valueCents - investedPerMonth),
    }));
  }

  const costPerLeadCents = closedLeads > 0 ? Math.round(investedCents / closedLeads) : null;

  return {
    closedLeads,
    months,
    investedCents,
    planName: plan.name,
    planPriceCents: plan.priceCents,
    valuePerLeadCents,
    valueStartsAt: effective?.startsAt ?? null,
    returnCents,
    roiPercent,
    cumulative,
    byAgent,
    breakEvenLeads,
    monthly,
    costPerLeadCents,
  };
}
