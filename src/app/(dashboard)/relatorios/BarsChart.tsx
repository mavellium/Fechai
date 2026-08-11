"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { ResultPoint } from "@/modules/reports/service";
import { ChartAxisY, niceAxisMax } from "@/components/charts/ChartAxisY";
import { ChartTooltip } from "@/components/charts/ChartTooltip";

/**
 * Resultados por bucket: leads novos × agendamentos.
 *
 * Barras em HTML puro (divs com altura proporcional), como a Sparkline da home —
 * sem biblioteca de gráfico. Zero **não desenha barra** (só um tique de 1px na
 * base) — o piso antigo de 4% de altura fazia um bucket zerado parecer um
 * bucket com dado, o que é uma mentira de leitura. Gap de 2px na cor da
 * superfície entre barras adjacentes (skill dataviz: "surface gap", nunca uma
 * borda desenhada). Tooltip por marca no hover/foco, além do `title` nativo.
 *
 * As barras usam `flex-1` com teto (`max-w-3`), não largura fixa: com muitos
 * buckets (dias de um ano, horas de um dia) elas encolhem em vez de vazar do
 * card.
 */
export function BarsChart({
  points,
  className,
}: {
  points: ResultPoint[];
  /** Altura das barras — o padrão é compacto no card; tela cheia passa maior. */
  className?: string;
}) {
  const [active, setActive] = useState<number | null>(null);

  const totalLeads = points.reduce((s, p) => s + p.leads, 0);
  const totalAppts = points.reduce((s, p) => s + p.appts, 0);
  if (totalLeads === 0 && totalAppts === 0) {
    return <p className="py-8 text-center text-sm text-neutral panel:text-white/55">Nenhum lead nem agendamento no período.</p>;
  }

  const rawMax = Math.max(1, ...points.flatMap((p) => [p.leads, p.appts]));
  const max = niceAxisMax(rawMax);
  const height = (v: number) => `${(v / max) * 100}%`;
  const peakLeads = points.reduce((best, p) => (p.leads > best.leads ? p : best), points[0]);
  const peakAppts = points.reduce((best, p) => (p.appts > best.appts ? p : best), points[0]);

  const summary =
    `${totalLeads} leads novos e ${totalAppts} agendamentos no período. ` +
    `Pico de ${peakLeads.leads} leads em ${peakLeads.label}; ` +
    `${peakAppts.appts} agendamentos em ${peakAppts.label}.`;

  const activePoint = active !== null ? points[active] : null;
  const barPct = points.length > 0 ? 100 / points.length : 0;

  return (
    <figure>
      <div className="relative">
        <ChartAxisY max={max} />
        <div
          role="img"
          aria-label={summary}
          className={cn("relative flex items-end gap-0.5", className ?? "h-44")}
          onPointerLeave={() => setActive(null)}
        >
          {points.map((p, i) => (
            <div
              key={p.key}
              className="group flex h-full min-w-0 flex-1 items-end justify-center gap-0.5 px-px"
              onPointerMove={() => setActive(i)}
            >
              <button
                type="button"
                tabIndex={0}
                title={`${p.label}: ${p.leads} leads novos`}
                aria-label={`${p.label}: ${p.leads} leads novos`}
                className={cn(
                  "min-w-0 max-w-3 flex-1 rounded-t-sm bg-iris transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris",
                  active === i ? "opacity-100" : "opacity-90 group-hover:opacity-100",
                )}
                style={{ height: p.leads === 0 ? "1px" : height(p.leads) }}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
              />
              <button
                type="button"
                tabIndex={0}
                title={`${p.label}: ${p.appts} agendamentos`}
                aria-label={`${p.label}: ${p.appts} agendamentos`}
                className={cn(
                  "min-w-0 max-w-3 flex-1 rounded-t-sm bg-success transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success",
                  active === i ? "opacity-100" : "opacity-90 group-hover:opacity-100",
                )}
                style={{ height: p.appts === 0 ? "1px" : height(p.appts) }}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
              />
            </div>
          ))}
        </div>
        {activePoint && (
          <ChartTooltip
            left={(active! + 0.5) * barPct}
            content={{
              title: activePoint.label,
              rows: [
                { label: "Leads novos", value: String(activePoint.leads), color: "var(--color-iris)" },
                { label: "Agendamentos", value: String(activePoint.appts), color: "var(--color-success)" },
              ],
            }}
          />
        )}
      </div>
      <figcaption className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral panel:text-white/55">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-iris" aria-hidden />
            Leads novos · pico {peakLeads.leads} em {peakLeads.label}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-success" aria-hidden />
            Agendamentos · pico {peakAppts.appts} em {peakAppts.label}
          </span>
        </div>
        <div className="flex gap-4 font-mono tabular-nums">
          <span>{points[0].label}</span>
          <span>{points[points.length - 1].label}</span>
        </div>
      </figcaption>
    </figure>
  );
}
