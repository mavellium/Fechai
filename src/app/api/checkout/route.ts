import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isStripeConfigured } from "@/modules/billing/stripe";
import { createCheckoutSession } from "@/modules/billing/checkout";
import { isValidPlan } from "@/modules/billing/service";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: "Pagamento indisponível: Stripe não configurado neste ambiente." },
      { status: 503 },
    );
  }

  const body = await req.json().catch(() => null);
  const planKey = body?.planKey;
  if (!planKey || !isValidPlan(planKey) || planKey === "FREE") {
    return NextResponse.json({ error: "Plano inválido" }, { status: 400 });
  }

  const origin = new URL(req.url).origin;
  try {
    const checkout = await createCheckoutSession({
      tenantId: session.user.tenantId,
      planKey,
      customerEmail: session.user.email ?? undefined,
      origin,
    });
    return NextResponse.json({ url: checkout.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Falha ao criar checkout";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
