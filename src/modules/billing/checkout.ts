import type { PlanKey } from "@prisma/client";
import { getStripe } from "./stripe";
import { PLAN_BY_KEY } from "./plans";

// Cria uma Checkout Session usando price_data inline (sem preços pré-cadastrados
// no dashboard da Stripe) — ver ADR-002. Simplifica o MVP: só precisa da secret key.
export async function createCheckoutSession(opts: {
  tenantId: string;
  planKey: PlanKey;
  customerEmail?: string;
  origin: string;
}) {
  const plan = PLAN_BY_KEY[opts.planKey];
  if (!plan || plan.priceCents <= 0) {
    throw new Error("Plano inválido para checkout pago");
  }

  const stripe = getStripe();
  return stripe.checkout.sessions.create({
    mode: "subscription",
    customer_email: opts.customerEmail,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "brl",
          unit_amount: plan.priceCents,
          recurring: { interval: "month" },
          product_data: { name: `Plano ${plan.name}` },
        },
      },
    ],
    // Fonte de verdade para o webhook provisionar/atualizar o tenant.
    metadata: { tenantId: opts.tenantId, planKey: opts.planKey },
    subscription_data: { metadata: { tenantId: opts.tenantId, planKey: opts.planKey } },
    success_url: `${opts.origin}/inicio?checkout=success`,
    cancel_url: `${opts.origin}/planos?checkout=cancel`,
  });
}
