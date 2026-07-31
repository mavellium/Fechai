import Link from "next/link";
import { requireTenant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { isStripeConfigured } from "@/modules/billing/stripe";
import { PlanPicker } from "./PlanPicker";
import { FadeIn } from "@/components/ui/FadeIn";

export default async function PlanosPage() {
  const { tenantId } = await requireTenant();
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });

  return (
    <div className="min-h-screen bg-paper px-4 py-16">
      <FadeIn className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="font-display text-3xl font-bold tracking-tight text-ink">Escolha seu plano</h1>
          <p className="mt-3 text-neutral">
            Comece grátis agora ou assine um plano pago. Você pode mudar depois.
          </p>
          {!isStripeConfigured() && (
            <p className="mt-4 rounded-md bg-warn/10 px-4 py-2 text-sm text-warn">
              Pagamentos em modo de teste ainda não configurados neste ambiente — o plano grátis
              funciona normalmente.
            </p>
          )}
        </div>

        <div className="mt-12">
          <PlanPicker currentPlan={tenant?.planKey ?? "FREE"} />
        </div>

        <p className="mt-8 text-center text-sm text-neutral">
          <Link href="/inicio" className="hover:underline">
            Pular por agora e ir para o painel
          </Link>
        </p>
      </FadeIn>
    </div>
  );
}
