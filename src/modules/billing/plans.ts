import type { PlanKey } from "@prisma/client";

// Fonte única de verdade dos planos. Usada na landing (Milestone 2) e na
// seleção de plano + Stripe Checkout (Milestone 3).
export type Plan = {
  key: PlanKey;
  name: string;
  priceLabel: string; // exibição na UI
  priceCents: number; // 0 = grátis
  conversationsPerMonth: number;
  maxActiveActions: number;
  /** Teto de agentes ativos (não arquivados) por conta. */
  maxAgents: number;
  highlight?: boolean;
  features: string[];
};

export const PLANS: Plan[] = [
  {
    key: "FREE",
    name: "Grátis",
    priceLabel: "R$ 0",
    priceCents: 0,
    conversationsPerMonth: 50,
    maxActiveActions: 2,
    maxAgents: 1,
    features: ["1 agente", "50 conversas/mês", "2 ações ativas", "Sandbox de teste"],
  },
  {
    key: "STARTER",
    name: "Starter",
    priceLabel: "R$ 97",
    priceCents: 9700,
    conversationsPerMonth: 500,
    maxActiveActions: 3,
    maxAgents: 2,
    features: ["2 agentes", "500 conversas/mês", "3 ações ativas", "Follow-up automático"],
  },
  {
    key: "PRO",
    name: "Pro",
    priceLabel: "R$ 247",
    priceCents: 24700,
    conversationsPerMonth: 2000,
    maxActiveActions: 5,
    maxAgents: 5,
    highlight: true,
    features: ["5 agentes", "2.000 conversas/mês", "Todas as ações", "Suporte prioritário"],
  },
  {
    key: "BUSINESS",
    name: "Business",
    priceLabel: "R$ 597",
    priceCents: 59700,
    conversationsPerMonth: 10000,
    maxActiveActions: 5,
    maxAgents: 15,
    features: ["15 agentes", "10.000 conversas/mês", "Todas as ações", "Onboarding assistido"],
  },
];

export const PLAN_BY_KEY = Object.fromEntries(PLANS.map((p) => [p.key, p])) as Record<PlanKey, Plan>;

export function planOf(planKey: PlanKey | null | undefined): Plan {
  return PLAN_BY_KEY[planKey ?? "FREE"];
}
