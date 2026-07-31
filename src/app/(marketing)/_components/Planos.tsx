import Link from "next/link";
import { Check } from "lucide-react";
import { PLANS } from "@/modules/billing/plans";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function Planos() {
  return (
    <section id="planos" className="bg-paper px-4 py-20 md:py-28">
      <div className="mx-auto max-w-6xl">
        <div className="reveal flex items-baseline justify-between gap-4">
          <h2 className="font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">
            Planos
          </h2>
          <p className="hidden font-mono text-[11px] uppercase tracking-[0.25em] text-neutral sm:block">
            comece grátis · mude quando crescer
          </p>
        </div>

        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {PLANS.map((plan) => {
            const dark = Boolean(plan.highlight);
            return (
              <div
                key={plan.key}
                className={cn(
                  "reveal flex flex-col rounded-xl p-6 md:p-7",
                  dark
                    ? "bg-ink text-white lg:-my-3 lg:py-10"
                    : "border border-neutral/20 bg-white",
                )}
              >
                <div className="flex items-baseline justify-between">
                  <h3 className={cn("font-display text-lg font-semibold", dark ? "text-white" : "text-ink")}>
                    {plan.name}
                  </h3>
                  {dark && (
                    <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-signal">
                      mais usado
                    </span>
                  )}
                </div>
                <p className="mt-3">
                  <span className={cn("font-display text-4xl font-bold", dark ? "text-white" : "text-ink")}>
                    {plan.priceLabel}
                  </span>
                  {plan.priceCents > 0 && (
                    <span className={cn("font-mono text-xs", dark ? "text-white/50" : "text-neutral")}>
                      {" "}/mês
                    </span>
                  )}
                </p>
                <ul className={cn("mt-6 flex-1 space-y-2.5 text-sm", dark ? "text-white/70" : "text-neutral")}>
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check size={15} className="mt-0.5 shrink-0 text-success" aria-hidden />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link href="/cadastro" className="mt-7">
                  <Button className="w-full" variant={dark ? "cta" : "outline"}>
                    {plan.priceCents === 0 ? "Começar grátis" : "Assinar"}
                  </Button>
                </Link>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
