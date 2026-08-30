import type { PlanKey } from "@prisma/client";

// Fonte única de verdade dos planos. Usada na landing, na seleção de plano e no
// Stripe Checkout.
export type Plan = {
  key: PlanKey;
  name: string;
  priceLabel: string; // exibição na UI
  priceCents: number; // 0 = grátis
  /**
   * A ÚNICA cota da conta: respostas da IA por mês, somadas todas as conversas.
   *
   * Antes existiam duas cotas (conversas/mês + teto por conversa) e nenhuma das
   * duas media o que de fato custa: uma conversa pode ter 2 ou 200 respostas, e
   * é a resposta — não a conversa — que consome LLM. Contar mensagem é contar a
   * coisa certa, e uma cota só é uma cota que o cliente entende.
   */
  messagesPerMonth: number;
  maxActiveActions: number;
  /** Teto de agentes ativos (não arquivados) por conta. */
  maxAgents: number;
  /**
   * Plano de teste por tempo: vale por N dias a partir da criação da conta e
   * depois para de responder até a pessoa assinar (ver `usage.ts`). Só o FREE
   * usa; nos pagos é `undefined` (a assinatura é que mantém a conta viva).
   */
  trialDays?: number;
  highlight?: boolean;
  features: string[];
};

export const PLANS: Plan[] = [
  {
    key: "FREE",
    name: "Grátis",
    priceLabel: "R$ 0",
    priceCents: 0,
    messagesPerMonth: 100,
    maxActiveActions: 2,
    maxAgents: 1,
    trialDays: 7,
    features: [
      "7 dias para testar",
      "100 mensagens no período",
      "1 agente",
      "2 ações ativas",
      "Sandbox de teste",
    ],
  },
  {
    key: "STARTER",
    name: "Starter",
    priceLabel: "R$ 199",
    priceCents: 19900,
    messagesPerMonth: 3000,
    maxActiveActions: 3,
    maxAgents: 3,
    features: ["3 agentes", "3.000 mensagens/mês", "3 ações ativas", "Follow-up automático"],
  },
  {
    key: "PRO",
    name: "Pro",
    priceLabel: "R$ 399",
    priceCents: 39900,
    messagesPerMonth: 9000,
    maxActiveActions: 5,
    maxAgents: 5,
    highlight: true,
    features: ["5 agentes", "9.000 mensagens/mês", "Todas as ações", "Suporte prioritário"],
  },
  {
    key: "BUSINESS",
    name: "Business",
    priceLabel: "R$ 899",
    priceCents: 89900,
    messagesPerMonth: 30000,
    maxActiveActions: 5,
    maxAgents: 10,
    features: ["10 agentes", "30.000 mensagens/mês", "Todas as ações", "Onboarding assistido"],
  },
];

export const PLAN_BY_KEY = Object.fromEntries(PLANS.map((p) => [p.key, p])) as Record<PlanKey, Plan>;

export function planOf(planKey: PlanKey | null | undefined): Plan {
  return PLAN_BY_KEY[planKey ?? "FREE"];
}
