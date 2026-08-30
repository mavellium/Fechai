"use client";

import { useId, useState } from "react";
import { PLANS } from "@/modules/billing/plans";
import {
  bpsToPercentLabel,
  commissionOf,
  nextTierFor,
  tierFor,
} from "@/modules/affiliates/config";
import { formatBRL } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Simulador de ganhos.
 *
 * É a peça de venda central da página: o argumento "comissão recorrente" só
 * convence quando a pessoa vê o próprio número. O cálculo usa os preços reais
 * de `billing/plans` — se um plano mudar de preço, esta seção acompanha
 * sozinha, sem número chumbado que envelhece.
 */

const PAGOS = PLANS.filter((p) => p.priceCents > 0);

export function Calculadora() {
  const [planKey, setPlanKey] = useState(PAGOS.find((p) => p.highlight)?.key ?? PAGOS[0].key);
  const [quantidade, setQuantidade] = useState(5);
  const sliderId = useId();

  const plano = PAGOS.find((p) => p.key === planKey) ?? PAGOS[0];
  // O percentual sai da quantidade simulada: mexer no slider mostra a faixa
  // mudando, que é justamente o que o programa de níveis quer comunicar.
  const faixa = tierFor(quantidade);
  const proxima = nextTierFor(quantidade);
  const porIndicacao = commissionOf(plano.priceCents, faixa.bps);
  const mensal = porIndicacao * quantidade;

  return (
    <section
      id="quanto-ganha"
      className="border-t border-ink/10 bg-paper px-4 py-20 md:py-28"
      aria-labelledby="calculadora-titulo"
    >
      <div className="mx-auto max-w-6xl">
        <p className="reveal font-mono text-micro uppercase tracking-[0.3em] text-neutral">
          simulador
        </p>
        <h2
          id="calculadora-titulo"
          className="reveal font-display mt-5 max-w-2xl text-3xl font-bold leading-[1.08] tracking-tight text-ink sm:text-4xl"
        >
          Quanto você ganharia por mês?
        </h2>
        <p className="reveal mt-4 max-w-prose leading-relaxed text-neutral">
          Escolha o plano que você pretende divulgar e quantas indicações consegue fechar. O valor
          abaixo é o que entra <strong className="font-semibold text-ink">todo mês</strong>,
          enquanto esses clientes continuarem assinando.
        </p>

        <div className="reveal mt-12 grid gap-8 lg:grid-cols-[1fr_0.85fr] lg:gap-12">
          {/* Controles */}
          <div className="rounded-xl border border-neutral/20 bg-white p-6 md:p-8">
            <fieldset>
              <legend className="font-mono text-micro uppercase tracking-[0.2em] text-neutral">
                Plano indicado
              </legend>
              <div className="mt-4 grid grid-cols-3 gap-2">
                {PAGOS.map((p) => {
                  const on = p.key === planKey;
                  return (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => setPlanKey(p.key)}
                      aria-pressed={on}
                      className={cn(
                        "rounded-control border px-3 py-3 text-left transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris focus-visible:ring-offset-2",
                        on
                          ? "border-iris bg-iris/5"
                          : "border-neutral/20 hover:border-neutral/40",
                      )}
                    >
                      <span
                        className={cn(
                          "font-display block text-sm font-semibold",
                          on ? "text-iris" : "text-ink",
                        )}
                      >
                        {p.name}
                      </span>
                      <span className="mt-0.5 block font-mono text-xs tabular-nums text-neutral">
                        {p.priceLabel}
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <div className="mt-8">
              <label
                htmlFor={sliderId}
                className="flex items-baseline justify-between font-mono text-micro uppercase tracking-[0.2em] text-neutral"
              >
                Indicações ativas
                <span className="font-display text-2xl font-bold tabular-nums text-ink">
                  {quantidade}
                </span>
              </label>
              <input
                id={sliderId}
                type="range"
                min={1}
                max={120}
                value={quantidade}
                onChange={(e) => setQuantidade(Number(e.target.value))}
                className="mt-4 h-2 w-full cursor-pointer appearance-none rounded-full bg-ink/10 accent-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris focus-visible:ring-offset-2"
              />
              <div className="mt-2 flex justify-between font-mono text-[11px] tabular-nums text-neutral/70">
                <span>1</span>
                <span>120</span>
              </div>
            </div>

            <div className="mt-8 border-t border-neutral/15 pt-6 text-sm leading-relaxed text-neutral">
              <p>
                Com {quantidade} {quantidade === 1 ? "venda" : "vendas"} você está no nível{" "}
                <strong className="font-semibold text-ink">{faixa.label}</strong>: cada assinatura
                {" "}{plano.name} de {plano.priceLabel} paga{" "}
                <strong className="font-semibold text-ink">{formatBRL(porIndicacao)}</strong> por
                mês ({bpsToPercentLabel(faixa.bps)}).
              </p>
              {proxima && (
                <p className="mt-2">
                  Mais {proxima.salesToGo}{" "}
                  {proxima.salesToGo === 1 ? "venda" : "vendas"} e você sobe para{" "}
                  <strong className="font-semibold text-ink">{proxima.tier.label}</strong> —{" "}
                  {bpsToPercentLabel(proxima.tier.bps)} em todas elas.
                </p>
              )}
            </div>
          </div>

          {/* Resultado */}
          <div className="flex flex-col justify-center rounded-xl bg-ink p-8 text-white md:p-10">
            <p className="flex flex-wrap items-center gap-2 font-mono text-micro uppercase tracking-[0.2em] text-white/45">
              sua renda recorrente
              <span className="rounded-full bg-signal/15 px-2 py-0.5 text-signal">
                nível {faixa.label} · {bpsToPercentLabel(faixa.bps)}
              </span>
            </p>
            <p className="mt-4">
              <span className="font-display text-5xl font-bold tabular-nums tracking-tight text-white sm:text-6xl">
                {formatBRL(mensal)}
              </span>
              <span className="ml-2 font-mono text-sm text-white/45">/mês</span>
            </p>

            <dl className="mt-8 space-y-3 border-t border-white/10 pt-6 text-sm">
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-white/50">Em 6 meses</dt>
                <dd className="font-mono tabular-nums text-white/85">{formatBRL(mensal * 6)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-white/50">Em 12 meses</dt>
                <dd className="font-display text-lg font-semibold tabular-nums text-signal">
                  {formatBRL(mensal * 12)}
                </dd>
              </div>
            </dl>

            <p className="mt-6 text-xs leading-relaxed text-white/40">
              Projeção considerando que as indicações permaneçam assinando no período. Cliente que
              cancela deixa de gerar comissão a partir do mês seguinte.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
