import { prisma } from "@/lib/prisma";
import { PLANS, planOf, type Plan } from "./plans";

/**
 * Uso de conversas do mês corrente — a métrica que o enforcement respeita e que
 * os indicadores mostram (sidebar, /configuracoes). Igual ao contador da home:
 * conversas REAIS (não teste) com atividade desde o dia 1 do mês; o sandbox não
 * conta. O limite é o do plano, salvo se o superadmin fixou um override em
 * /admin/contas (`conversationLimitOverride`).
 */
export type UsageSummary = {
  used: number;
  /** Limite efetivo: override do admin ou o teto do plano. */
  limit: number;
  plan: Plan;
  /** used >= limit: enforcement bloqueia novos turnos da IA. */
  atLimit: boolean;
  /** Limite veio de um override do superadmin (não do plano). */
  override: boolean;
  /**
   * Teto de respostas da IA por conversa/mês. Padrão: limite efetivo de
   * conversas × 3 (a cota da conta é por conversa, então sem isso um único
   * chat usaria o LLM à vontade). O superadmin pode fixar um override próprio
   * em /admin/contas (`perConversationCapOverride`) — as duas cotas ficam
   * independentes. Uma conversa que estoura esse teto cala a IA nela mesma.
   */
  perConversationCap: number;
  /** Maior número de respostas da IA numa única conversa neste mês (uso real
   *  do teto por conversa — a "conversa mais ativa"). */
  perConversationUsed: number;
  /** Próximo plano com cota maior que a atual (recomendação de upgrade). */
  nextPlan: Plan | null;
  /** Trial de uso ilimitado ativo (`Tenant.trialUnlimitedUntil` no futuro): as
   *  duas cotas ficam informativas só, o enforcement não bloqueia. */
  unlimitedTrial: boolean;
  /** Fim do trial ilimitado, se houver (passado ou futuro). */
  trialEndsAt: Date | null;
};

export async function getUsageSummary(tenantId: string): Promise<UsageSummary> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      planKey: true,
      conversationLimitOverride: true,
      perConversationCapOverride: true,
      trialUnlimitedUntil: true,
    },
  });

  const unlimitedTrial = Boolean(tenant?.trialUnlimitedUntil && tenant.trialUnlimitedUntil > new Date());

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const used = await prisma.conversation.count({
    where: { tenantId, isTest: false, updatedAt: { gte: monthStart } },
  });

  // Uso real do teto por conversa: quantas respostas a conversa MAIS ativa já
  // consumiu neste mês. É o número que o bloco "Teto por conversa" mostra.
  const busiest = await prisma.message.groupBy({
    by: ["conversationId"],
    where: {
      conversation: { tenantId, isTest: false },
      role: "assistant",
      sentBy: "agent",
      createdAt: { gte: monthStart },
    },
    _count: { conversationId: true },
    orderBy: { _count: { conversationId: "desc" } },
    take: 1,
  });
  const perConversationUsed = busiest[0]?._count.conversationId ?? 0;

  const plan = planOf(tenant?.planKey);
  const limit = tenant?.conversationLimitOverride ?? plan.conversationsPerMonth;
  const nextPlan = PLANS.find((p) => p.conversationsPerMonth > limit) ?? null;

  return {
    used,
    limit,
    plan,
    atLimit: !unlimitedTrial && used >= limit,
    override: tenant?.conversationLimitOverride != null,
    // Teto por conversa: override próprio do admin, senão o padrão do plano,
    // senão deriva do limite efetivo de conversas (× 3).
    perConversationCap: tenant?.perConversationCapOverride ?? plan.perConversationCapDefault ?? limit * 3,
    perConversationUsed,
    nextPlan,
    unlimitedTrial,
    trialEndsAt: tenant?.trialUnlimitedUntil ?? null,
  };
}
