"use client";

import { cn } from "@/lib/utils";
import type { ResultPoint } from "@/modules/reports/service";

/**
 * Resultados por bucket: leads novos × agendamentos.
 *
 * Barras em HTML puro (divs com altura proporcional), como a Sparkline da home —
 * sem biblioteca de gráfico. Altura mínima de 4% para o bucket zerado não sumir
 * da série; tooltip nativo (`title`) em cada barra.
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
  const totalLeads = points.reduce((s, p) => s + p.leads, 0);
  const totalAppts = points.reduce((s, p) => s + p.appts, 0);
  if (totalLeads === 0 && totalAppts === 0) {
    return <p className="py-8 text-center text-sm text-neutral panel:text-white/55">Nenhum lead nem agendamento no período.</p>;
  }

  const max = Math.max(1, ...points.flatMap((p) => [p.leads, p.appts]));
  const height = (v: number) => `${Math.max(4, (v / max) * 100)}%`;
  const peakLeads = points.reduce((best, p) => (p.leads > best.leads ? p : best), points[0]);
  const peakAppts = points.reduce((best, p) => (p.appts > best.appts ? p : best), points[0]);

  const summary =
    `${totalLeads} leads novos e ${totalAppts} agendamentos no período. ` +
    `Pico de ${peakLeads.leads} leads em ${peakLeads.label}; ` +
    `${peakAppts.appts} agendamentos em ${peakAppts.label}.`;

  return (
    <figure>
      <div role="img" aria-label={summary} className={cn("flex items-end gap-0.5", className ?? "h-44")}>
        {points.map((p) => (
          <div key={p.key} className="flex h-full min-w-0 flex-1 items-end justify-center gap-0.5">
            <div
              title={`${p.label}: ${p.leads} leads novos`}
              className="min-w-0 max-w-3 flex-1 rounded-t-sm bg-iris"
              style={{ height: height(p.leads) }}
            />
            <div
              title={`${p.label}: ${p.appts} agendamentos`}
              className="min-w-0 max-w-3 flex-1 rounded-t-sm bg-success"
              style={{ height: height(p.appts) }}
            />
          </div>
        ))}
      </div>
      <figcaption className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral panel:text-white/55">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-iris" aria-hidden />
            Leads novos
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-success" aria-hidden />
            Agendamentos
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
