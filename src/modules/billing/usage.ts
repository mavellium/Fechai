import { prisma } from "@/lib/prisma";
import { PLANS, planOf, type Plan } from "./plans";

/**
 * Uso da conta no mês corrente — a métrica que o enforcement respeita e que os
 * indicadores mostram (sidebar, /configuracoes).
 *
 * A cota é **mensagens**: respostas da IA desde o dia 1 do mês, somadas todas
 * as conversas reais (o sandbox não conta — testar não é atendimento). Antes
 * eram duas cotas, conversas/mês e um teto por conversa, e nenhuma media o que
 * custa: quem paga LLM é a resposta, não a conversa. Uma cota só, na unidade
 * certa.
 *
 * O plano grátis tem ainda uma segunda trava, de tempo: `Tenant.trialEndsAt`.
 * Ele é um teste de 7 dias com 100 mensagens — acaba o que vier primeiro.
 */
export type UsageSummary = {
  /** Respostas da IA neste mês (conversas reais; sandbox fora). */
  used: number;
  /** Cota efetiva: override do admin ou o teto do plano. */
  limit: number;
  plan: Plan;
  /** Cota estourada OU trial expirado: o enforcement cala a IA. */
  atLimit: boolean;
  /** `true` quando a IA parou por acabar a cota de mensagens. */
  outOfMessages: boolean;
  /** Limite veio de um override do superadmin (não do plano). */
  override: boolean;
  /** Plano de teste por tempo (só o FREE). */
  isTrial: boolean;
  /** Fim do teste, se o plano for de teste. */
  trialEndsAt: Date | null;
  /** `true` quando o teste acabou: a IA parou por tempo, não por cota. */
  trialExpired: boolean;
  /** Dias que faltam para o teste acabar (0 quando já acabou). */
  trialDaysLeft: number;
  /** Próximo plano com cota maior que a atual (recomendação de upgrade). */
  nextPlan: Plan | null;
};

export async function getUsageSummary(tenantId: string): Promise<UsageSummary> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { planKey: true, messageLimitOverride: true, trialEndsAt: true },
  });

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  // A cota conta RESPOSTAS DA IA (`sentBy: "agent"`), não mensagens do contato
  // nem respostas manuais do dono — só o que passou pelo LLM.
  const used = await prisma.message.count({
    where: {
      conversation: { tenantId, isTest: false },
      role: "assistant",
      sentBy: "agent",
      createdAt: { gte: monthStart },
    },
  });

  const plan = planOf(tenant?.planKey);
  const limit = tenant?.messageLimitOverride ?? plan.messagesPerMonth;

  const isTrial = plan.trialDays != null;
  const trialEndsAt = tenant?.trialEndsAt ?? null;
  // Sem data num plano de teste, o teste é tratado como encerrado: é o estado
  // de quem teve o trial zerado pelo admin.
  const trialExpired = isTrial && (!trialEndsAt || trialEndsAt <= new Date());
  const trialDaysLeft =
    isTrial && trialEndsAt && !trialExpired
      ? Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / 86_400_000))
      : 0;

  const outOfMessages = used >= limit;
  const nextPlan = PLANS.find((p) => p.messagesPerMonth > limit) ?? null;

  return {
    used,
    limit,
    plan,
    atLimit: outOfMessages || trialExpired,
    outOfMessages,
    override: tenant?.messageLimitOverride != null,
    isTrial,
    trialEndsAt,
    trialExpired,
    trialDaysLeft,
    nextPlan,
  };
}
