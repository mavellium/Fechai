"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import type { MonthlyPoint } from "@/modules/affiliates/stats";
import { ChartAxisY, niceAxisMax } from "@/components/charts/ChartAxisY";
import { ChartTooltip, type TooltipContent } from "@/components/charts/ChartTooltip";

/**
 * Ganhos do afiliado mês a mês — barras em HTML puro, como o resto dos
 * gráficos do painel (sem biblioteca).
 *
 * Mês zerado não desenha barra (só o tique de 1px na base): um piso mínimo
 * faria "não ganhei nada" parecer "ganhei um pouco".
 *
 * O eixo é arredondado em REAIS inteiros, não em centavos — `niceAxisMax`
 * sobre centavos produziria rótulos como "R$ 1.234,56", que ninguém lê num
 * eixo.
 */
export function EarningsChart({ points }: { points: MonthlyPoint[] }) {
  const [active, setActive] = useState<number | null>(null);

  const total = points.reduce((s, p) => s + p.earningsCents, 0);
  if (total === 0) {
    return (
      <p className="py-8 text-center text-sm text-neutral panel:text-white/55">
        Nenhuma comissão registrada nos últimos meses.
      </p>
    );
  }

  const rawMaxReais = Math.max(...points.map((p) => p.earningsCents)) / 100;
  const maxReais = niceAxisMax(rawMaxReais);
  const maxCents = maxReais * 100;

  const melhor = points.reduce((best, p) => (p.earningsCents > best.earningsCents ? p : best));
  const summary = `Ganhos por mês. Total de ${formatBRL(total)} no período, com pico de ${formatBRL(melhor.earningsCents)} em ${melhor.label}.`;

  const activePoint = active !== null ? points[active] : null;
  const tooltip: TooltipContent = activePoint
    ? {
        title: activePoint.label,
        rows: [
          { label: "Comissões", value: formatBRL(activePoint.earningsCents) },
          {
            label: "Pagamentos",
            value: String(activePoint.commissions),
          },
        ],
      }
    : null;

  return (
    <figure className="m-0">
      <figcaption className="sr-only">{summary}</figcaption>

      <div className="relative h-48 pl-10">
        <ChartAxisY max={maxReais} formatValue={(v) => formatBRL(v * 100)} />

        <div className="relative flex h-full items-end gap-1.5">
          {points.map((p, i) => {
            const pct = (p.earningsCents / maxCents) * 100;
            const on = active === i;
            return (
              <button
                key={p.month}
                type="button"
                className="group relative flex h-full flex-1 items-end rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris focus-visible:ring-offset-2 focus-visible:ring-offset-paper panel:focus-visible:ring-offset-ink"
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                aria-label={`${p.label}: ${formatBRL(p.earningsCents)} em ${p.commissions} pagamento${p.commissions === 1 ? "" : "s"}`}
              >
                {p.earningsCents === 0 ? (
                  <span className="h-px w-full bg-ink/15 panel:bg-white/20" aria-hidden />
                ) : (
                  <span
                    aria-hidden
                    className={cn(
                      "w-full rounded-t-sm transition-colors",
                      on ? "bg-signal" : "bg-iris group-hover:bg-signal",
                    )}
                    style={{ height: `${pct}%` }}
                  />
                )}
              </button>
            );
          })}
        </div>

        {activePoint && (
          <ChartTooltip
            content={tooltip}
            left={((active! + 0.5) / points.length) * 100}
            top={4}
          />
        )}
      </div>

      {/* Rótulos do eixo X, alinhados com as barras. */}
      <div className="mt-2 flex gap-1.5 pl-10">
        {points.map((p) => (
          <span
            key={p.month}
            className="flex-1 text-center font-mono text-[10px] uppercase tracking-wide text-neutral panel:text-white/45"
          >
            {p.label}
          </span>
        ))}
      </div>
    </figure>
  );
}
