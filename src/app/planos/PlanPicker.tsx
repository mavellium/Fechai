"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import posthog from "posthog-js";
import type { PlanKey } from "@prisma/client";
import { PLANS } from "@/modules/billing/plans";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function PlanPicker({ currentPlan }: { currentPlan: PlanKey }) {
  const router = useRouter();
  const [loading, setLoading] = useState<PlanKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(planKey: PlanKey) {
    setError(null);
    setLoading(planKey);
    try {
      if (planKey === "FREE") {
        const res = await fetch("/api/plan/free", { method: "POST" });
        if (!res.ok) throw new Error("Falha ao ativar plano grátis");
        posthog.capture("plan_selected", { plan_key: planKey, checkout_required: false });
        // Conta nova cai no onboarding; quem já passou por ele é levado ao
        // painel pelo próprio /onboarding.
        router.push("/onboarding");
        router.refresh();
        return;
      }
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planKey }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error ?? "Falha ao iniciar pagamento");
      posthog.capture("plan_selected", { plan_key: planKey, checkout_required: true });
      // `assign()` em vez de `location.href = ...`: mesmo efeito, mas a regra
      // react-hooks/immutability trata a atribuição como mutação de valor
      // externo e quebrava o `npm run lint` do repositório inteiro.
      window.location.assign(data.url); // redireciona para o Stripe Checkout
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
      setLoading(null);
    }
  }

  return (
    <div>
      {error && (
        <p className="mb-6 rounded-md bg-red-50 px-4 py-2 text-center text-sm text-red-600">
          {error}
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-4">
        {PLANS.map((plan) => (
          <div
            key={plan.key}
            className={cn(
              "flex flex-col rounded-2xl border bg-white p-6",
              plan.highlight ? "border-iris shadow-lg ring-1 ring-iris" : "border-neutral/20",
            )}
          >
            {plan.highlight && (
              <span className="mb-3 inline-block w-fit rounded-full bg-iris/15 px-2.5 py-0.5 text-xs font-medium text-iris">
                Mais popular
              </span>
            )}
            <h3 className="font-semibold text-ink">{plan.name}</h3>
            <p className="mt-2">
              <span className="text-3xl font-bold text-ink">{plan.priceLabel}</span>
              {plan.priceCents > 0 && <span className="text-neutral">/mês</span>}
            </p>
            <ul className="mt-6 flex-1 space-y-2 text-sm text-neutral">
              {plan.features.map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <Check size={16} className="mt-0.5 shrink-0 text-success" />
                  {f}
                </li>
              ))}
            </ul>
            <Button
              className="mt-6 w-full"
              variant={plan.highlight ? "default" : "outline"}
              disabled={loading !== null}
              onClick={() => choose(plan.key)}
            >
              {loading === plan.key
                ? "Processando..."
                : plan.key === currentPlan
                  ? "Continuar neste"
                  : plan.priceCents === 0
                    ? "Começar grátis"
                    : "Assinar"}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
