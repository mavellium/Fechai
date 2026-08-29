import type { PlanKey } from "@prisma/client";

// Fonte única de verdade dos planos. Usada na landing (Milestone 2) e na
// seleção de plano + Stripe Checkout (Milestone 3).
export type Plan = {
  key: PlanKey;
  name: string;
  priceLabel: string; // exibição na UI
  priceCents: number; // 0 = grátis
  conversationsPerMonth: number;
  /**
   * Teto de respostas da IA numa ÚNICA conversa por mês.
   *
   * Fixo por plano, e não derivado do limite de conversas. Já foi
   * `limite × 3`, o que só fazia sentido enquanto os volumes eram pequenos:
   * com 1.000 conversas/mês o multiplicador liberava 3.000 respostas num único
   * chat — mais do que a conta inteira deveria gastar, ou seja, um freio que
   * não freava nada. Uma conversa real de WhatsApp tem dezenas de respostas,
   * não milhares; estourar isso é loop ou abuso, e é o que o teto pega.
   *
   * `usage.ts` ainda tem o fallback `limite × 3` para o caso de um plano novo
   * entrar sem este campo — mas hoje todos os planos o definem.
   */
  perConversationCapDefault: number;
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
    conversationsPerMonth: 10,
    perConversationCapDefault: 100,
    maxActiveActions: 2,
    maxAgents: 1,
    features: ["1 agente", "10 conversas/mês", "2 ações ativas", "7 dias ilimitado", "Sandbox de teste"],
  },
  {
    key: "STARTER",
    name: "Starter",
    priceLabel: "R$ 199",
    priceCents: 19900,
    conversationsPerMonth: 1000,
    perConversationCapDefault: 150,
    maxActiveActions: 3,
    maxAgents: 3,
    features: ["3 agentes", "1.000 conversas/mês", "3 ações ativas", "Follow-up automático"],
  },
  {
    key: "PRO",
    name: "Pro",
    priceLabel: "R$ 399",
    priceCents: 39900,
    conversationsPerMonth: 3000,
    perConversationCapDefault: 200,
    maxActiveActions: 5,
    maxAgents: 5,
    highlight: true,
    features: ["5 agentes", "3.000 conversas/mês", "Todas as ações", "Suporte prioritário"],
  },
  {
    key: "BUSINESS",
    name: "Business",
    priceLabel: "R$ 899",
    priceCents: 89900,
    conversationsPerMonth: 10000,
    perConversationCapDefault: 300,
    maxActiveActions: 5,
    maxAgents: 10,
    features: ["10 agentes", "10.000 conversas/mês", "Todas as ações", "Onboarding assistido"],
  },
];

export const PLAN_BY_KEY = Object.fromEntries(PLANS.map((p) => [p.key, p])) as Record<PlanKey, Plan>;

export function planOf(planKey: PlanKey | null | undefined): Plan {
  return PLAN_BY_KEY[planKey ?? "FREE"];
}
