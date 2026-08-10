import { prisma } from "@/lib/prisma";
import { dateLabel } from "@/lib/format";
import { planOf } from "@/modules/billing/plans";

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

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
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

export type PeriodReport = {
  kpis: PeriodKpis;
  flow: FlowPoint[];
  results: ResultPoint[];
  byAgent: { name: string; count: number }[];
  byStatus: { status: string; count: number }[];
  /** Contatos atendidos só pela IA × contatos em que um humano respondeu. */
  attendance: AiHumanPoint[];
  /** Agendamentos fechados pela IA (`source: agent`) × manuais (`source: manual`). */
  closed: AiHumanPoint[];
};

const HOUR_MS = 3_600_000;
const MONTH_LABEL = new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit" });
const DAY_LABEL = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });
const HOUR_LABEL = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", hourCycle: "h23" });

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

/** "YYYY-MM-DD" da URL → Date local, ou null se malformado. */
function parseDate(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
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
    to = customTo ? new Date(customTo.getFullYear(), customTo.getMonth(), customTo.getDate(), 23, 59, 59, 999) : now;
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
      case "ano":
        from = new Date(now.getFullYear(), 0, 1);
        break;
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
  if (unit === "hora") return new Date(ts.getFullYear(), ts.getMonth(), ts.getDate(), ts.getHours());
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

  const [conversations, leads, scheduled, messages, leadRows, apptRows, engagedGroups, agentGroups, statusGroups, hotLeads, needsHuman, assistantMsgs, closedAppts] = await Promise.all([
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
    // Todos os agendamentos criados no período, com origem (IA vs manual).
    prisma.appointment.findMany({
      where: { tenantId, createdAt: { gte: from ?? undefined, lt: toExcl } },
      select: { source: true, createdAt: true },
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
  };
}

// ── Visão Financeira (retorno do investimento no projeto) ────────────────────

export type FinancialSummary = {
  /** Agendamentos criados no período — mesma base do gráfico "Leads fechados". */
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

  const [closedLeads, tenant, values] = await Promise.all([
    // Mesmo corte do gráfico "closed": agendamentos criados no período.
    prisma.appointment.count({
      where: { tenantId, createdAt: { gte: range.from ?? undefined, lt: toExcl } },
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

  const plan = planOf(tenant?.planKey);

  // "tudo" não tem `from`: ancora os meses na criação da conta.
  const anchor = range.from ?? tenant?.createdAt ?? range.to;
  const months = Math.max(
    1,
    (range.to.getFullYear() - anchor.getFullYear()) * 12 +
      (range.to.getMonth() - anchor.getMonth()) +
      1,
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
  };
}
