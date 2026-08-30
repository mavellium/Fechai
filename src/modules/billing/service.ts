import type { PlanKey } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { planOf } from "./plans";

const VALID_PLANS: PlanKey[] = ["FREE", "STARTER", "PRO", "BUSINESS"];

export function isValidPlan(key: string): key is PlanKey {
  return (VALID_PLANS as string[]).includes(key);
}

/**
 * Aplica a mudança de plano ao tenant. Chamado pelo fluxo grátis (direto) e
 * pelo webhook do Stripe (após confirmação de pagamento). Idempotente.
 *
 * A data do teste acompanha o plano: assinar um plano pago limpa `trialEndsAt`
 * (a assinatura é que mantém a conta viva, e um trial vencido pendurado faria
 * `atLimit` calar a IA de quem acabou de pagar). Voltar para um plano de teste
 * reabre a janela a partir de agora — é o caminho que o admin usa para dar uma
 * segunda chance a alguém.
 */
export async function setTenantPlan(tenantId: string, planKey: PlanKey) {
  const trialDays = planOf(planKey).trialDays;
  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      planKey,
      trialEndsAt: trialDays ? new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000) : null,
    },
  });
}
