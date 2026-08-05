import { prisma } from "@/lib/prisma";

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
