"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { ChartTooltip } from "./ChartTooltip";

export type DivergingPoint = { key: string; label: string; value: number };

/**
 * Barras divergentes: acima da linha zero é positivo, abaixo é negativo — a
 * forma certa para "acima/abaixo de uma referência" (skill dataviz,
 * `choosing-a-form.md`). Dois hues opostos (quente/frio) + o zero como
 * midpoint neutro. `success`/`warn` já são o par quente/frio validado no
 * resto do painel (usados em `attendance`); reaproveitado aqui, não uma cor nova.
 */
export function DivergingBars({
  points,
  formatValue = String,
  className,
}: {
  points: DivergingPoint[];
  formatValue?: (v: number) => string;
  className?: string;
}) {
  const [active, setActive] = useState<number | null>(null);

  const total = points.reduce((s, p) => s + Math.abs(p.value), 0);
  if (total === 0) {
    return <p className="py-8 text-center text-sm text-neutral panel:text-white/55">Nenhum dado no período.</p>;
  }

  const max = Math.max(1, ...points.map((p) => Math.abs(p.value)));
  const summary = points.map((p) => `${p.label}: ${formatValue(p.value)}`).join(", ");

  return (
    <figure>
      <div role="img" aria-label={summary} className={cn("flex items-stretch gap-1", className ?? "h-40")}>
        {points.map((p, i) => {
          const pct = (Math.abs(p.value) / max) * 50;
          const isPositive = p.value >= 0;
          return (
            <button
              key={p.key}
              type="button"
              tabIndex={0}
              aria-label={`${p.label}: ${formatValue(p.value)}`}
              className="group flex min-w-0 flex-1 flex-col justify-center focus-visible:outline-none"
              onPointerMove={() => setActive(i)}
              onPointerLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            >
              <div className="flex h-1/2 items-end justify-center px-px">
                {isPositive && (
                  <div
                    className={cn(
                      "w-full max-w-4 rounded-t-sm bg-success transition-opacity",
                      active === i ? "opacity-100" : "opacity-90 group-hover:opacity-100",
                    )}
                    style={{ height: `${pct}%` }}
                  />
                )}
              </div>
              <div className="flex h-1/2 items-start justify-center px-px">
                {!isPositive && (
                  <div
                    className={cn(
                      "w-full max-w-4 rounded-b-sm bg-warn transition-opacity",
                      active === i ? "opacity-100" : "opacity-90 group-hover:opacity-100",
                    )}
                    style={{ height: `${pct}%` }}
                  />
                )}
              </div>
            </button>
          );
        })}
      </div>
      <div aria-hidden className="-mt-[calc(50%+0.5px)] h-px w-full bg-ink/15 panel:bg-white/20" />
      {active !== null && (
        <ChartTooltip
          left={((active + 0.5) / points.length) * 100}
          top={points[active].value >= 0 ? 0 : 50}
          content={{
            title: points[active].label,
            rows: [
              {
                label: points[active].value >= 0 ? "Lucro" : "Prejuízo",
                value: formatValue(points[active].value),
                color: points[active].value >= 0 ? "var(--color-success)" : "var(--color-warn)",
              },
            ],
          }}
        />
      )}
      <figcaption className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral panel:text-white/55">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-success" aria-hidden />
            Lucro
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-warn" aria-hidden />
            Prejuízo
          </span>
        </div>
        <div className="flex gap-4 font-mono tabular-nums">
          <span>{points[0]?.label}</span>
          <span>{points[points.length - 1]?.label}</span>
        </div>
      </figcaption>
    </figure>
  );
}
