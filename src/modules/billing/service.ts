import type { PlanKey } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const VALID_PLANS: PlanKey[] = ["FREE", "STARTER", "PRO", "BUSINESS"];

export function isValidPlan(key: string): key is PlanKey {
  return (VALID_PLANS as string[]).includes(key);
}

// Aplica a mudança de plano ao tenant. Chamado pelo fluxo grátis (direto) e
// pelo webhook do Stripe (após confirmação de pagamento). Idempotente.
export async function setTenantPlan(tenantId: string, planKey: PlanKey) {
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { planKey },
  });
}
