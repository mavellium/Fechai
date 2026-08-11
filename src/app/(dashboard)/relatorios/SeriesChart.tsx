"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { ChartAxisY, niceAxisMax } from "@/components/charts/ChartAxisY";
import { ChartCrosshair, ChartHoverLayer, ChartTooltip } from "@/components/charts/ChartTooltip";

export type SeriesPoint = { key: string; label: string; a: number; b: number };

/**
 * Duas séries ao longo do tempo, como linhas sobrepostas (SVG sem biblioteca
 * de gráfico — mesma decisão da Sparkline: uma série curta não justifica um
 * runtime de charts). `preserveAspectRatio="none"` estica o desenho para a
 * largura disponível; as linhas usam `vectorEffect="non-scaling-stroke"` para
 * não emagrecerem ao esticar.
 *
 * Crosshair + tooltip por bucket (hover E foco de teclado leem o mesmo
 * conteúdo) substituem o `<title>` nativo, que tem delay do SO e não responde
 * a Tab. O `<title>` continua como reforço para leitores que ainda passam
 * pelo SVG. Eixo Y com três gridlines + rótulo do pico de cada série
 * (skill dataviz: rótulo direto seletivo, não um número por ponto).
 */
export function SeriesChart({
  points,
  labelA,
  labelB,
  colorA,
  colorB,
  empty,
  className,
  formatValue = String,
}: {
  points: SeriesPoint[];
  labelA: string;
  labelB: string;
  /** Classe de cor (`text-*`) da linha A e da área. */
  colorA: string;
  colorB: string;
  /** Mensagem do estado vazio (nada no período). */
  empty: string;
  /** Altura do desenho — o padrão é compacto no card; tela cheia passa maior. */
  className?: string;
  /** Formata um valor bruto para o rótulo do eixo/tooltip (ex.: `formatBRL`). */
  formatValue?: (v: number) => string;
}) {
  const [active, setActive] = useState<number | null>(null);

  const totalA = points.reduce((s, p) => s + p.a, 0);
  const totalB = points.reduce((s, p) => s + p.b, 0);
  if (totalA === 0 && totalB === 0) {
    return <p className="py-8 text-center text-sm text-neutral panel:text-white/55">{empty}</p>;
  }

  const rawMax = Math.max(1, ...points.flatMap((p) => [p.a, p.b]));
  const max = niceAxisMax(rawMax);
  const W = 100;
  const H = 100;
  const x = (i: number) => (points.length > 1 ? (i / (points.length - 1)) * W : W / 2);
  const y = (v: number) => H - (v / max) * H;
  const line = (pick: (p: SeriesPoint) => number) =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)} ${y(pick(p)).toFixed(2)}`).join(" ");
  const area = (pick: (p: SeriesPoint) => number) =>
    `${line(pick)} L ${x(points.length - 1).toFixed(2)} ${H} L ${x(0).toFixed(2)} ${H} Z`;

  const peakA = points.reduce((best, p) => (p.a > best.a ? p : best), points[0]);
  const peakB = points.reduce((best, p) => (p.b > best.b ? p : best), points[0]);
  const peakIndexA = points.indexOf(peakA);
  const peakIndexB = points.indexOf(peakB);

  const activePoint = active !== null ? points[active] : null;
  const tooltipColorA = colorA.startsWith("text-") ? `var(--color-${colorA.slice(5)})` : undefined;
  const tooltipColorB = colorB.startsWith("text-") ? `var(--color-${colorB.slice(5)})` : undefined;

  return (
    <figure>
      <div className="relative">
        <ChartAxisY max={max} formatValue={formatValue} />
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${labelA}: ${totalA}; ${labelB}: ${totalB}. Pico de ${peakA.a} em ${peakA.label} e ${peakB.b} em ${peakB.label}.`}
          className={cn("relative w-full", className ?? "h-48")}
        >
          <g className={colorB}>
            <path d={area((p) => p.b)} className="fill-current opacity-10" />
            <path d={line((p) => p.b)} fill="none" strokeWidth={1.5} vectorEffect="non-scaling-stroke" className="stroke-current" />
          </g>
          <g className={colorA}>
            <path d={area((p) => p.a)} className="fill-current opacity-10" />
            <path d={line((p) => p.a)} fill="none" strokeWidth={1.5} vectorEffect="non-scaling-stroke" className="stroke-current" />
          </g>
          {points.map((p) => (
            <title key={p.key}>{`${p.label}: ${p.a} ${labelA} · ${p.b} ${labelB}`}</title>
          ))}
        </svg>
        <ChartCrosshair left={activePoint ? x(active!) : null} />
        <ChartHoverLayer
          count={points.length}
          active={active}
          onActivate={setActive}
          onLeave={() => setActive(null)}
          labels={points.map((p) => `${p.label}: ${formatValue(p.a)} ${labelA}, ${formatValue(p.b)} ${labelB}`)}
        />
        {activePoint && (
          <ChartTooltip
            left={x(active!)}
            content={{
              title: activePoint.label,
              rows: [
                { label: labelA, value: formatValue(activePoint.a), color: tooltipColorA },
                { label: labelB, value: formatValue(activePoint.b), color: tooltipColorB },
              ],
            }}
          />
        )}
      </div>
      <figcaption className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral panel:text-white/55">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${colorA.replace("text-", "bg-")}`} aria-hidden />
            {labelA} · pico {formatValue(peakA.a)} em {points[peakIndexA]?.label}
          </span>
          <span className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${colorB.replace("text-", "bg-")}`} aria-hidden />
            {labelB} · pico {formatValue(peakB.b)} em {points[peakIndexB]?.label}
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
