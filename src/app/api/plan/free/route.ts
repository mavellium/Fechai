import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { setTenantPlan } from "@/modules/billing/service";

// Fluxo grátis: sem Stripe. Marca o tenant como FREE e libera o dashboard.
export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }
  await setTenantPlan(session.user.tenantId, "FREE");
  return NextResponse.json({ ok: true });
}
