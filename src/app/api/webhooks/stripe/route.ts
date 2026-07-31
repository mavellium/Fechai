import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/modules/billing/stripe";
import { isValidPlan, setTenantPlan } from "@/modules/billing/service";

// Webhook do Stripe. Precisa do corpo cru (req.text) para validar a assinatura.
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Webhook não configurado" }, { status: 503 });
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "Assinatura ausente" }, { status: 400 });

  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(raw, sig, secret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "assinatura inválida";
    return NextResponse.json({ error: `Webhook inválido: ${message}` }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object as Stripe.Checkout.Session;
        await applyPlanFromMetadata(s.metadata);
        break;
      }
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        if (sub.status === "active" || sub.status === "trialing") {
          await applyPlanFromMetadata(sub.metadata);
        }
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const tenantId = sub.metadata?.tenantId;
        if (tenantId) await setTenantPlan(tenantId, "FREE"); // cancelou → volta ao grátis
        break;
      }
      default:
        break;
    }
  } catch (err) {
    console.error("[stripe webhook] erro ao processar", event.type, err);
    return NextResponse.json({ error: "Falha ao processar evento" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function applyPlanFromMetadata(metadata: Stripe.Metadata | null | undefined) {
  const tenantId = metadata?.tenantId;
  const planKey = metadata?.planKey;
  if (!tenantId || !planKey || !isValidPlan(planKey)) return;
  await setTenantPlan(tenantId, planKey);
}
