"use client";

import { cn } from "@/lib/utils";

export type SeriesPoint = { key: string; label: string; a: number; b: number };

/**
 * Duas séries ao longo do tempo, como linhas sobrepostas (SVG sem biblioteca
 * de gráfico — mesma decisão da Sparkline: uma série curta não justifica um
 * runtime de charts). `preserveAspectRatio="none"` estica o desenho para a
 * largura disponível; as linhas usam `vectorEffect="non-scaling-stroke"` para
 * não emagrecerem ao esticar.
 *
 * Tooltips são o `<title>` nativo de cada coluna (hover). Para leitor de tela,
 * o resumo em texto está no `role="img"` do svg.
 */
export function SeriesChart({
  points,
  labelA,
  labelB,
  colorA,
  colorB,
  empty,
  className,
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
}) {
  const totalA = points.reduce((s, p) => s + p.a, 0);
  const totalB = points.reduce((s, p) => s + p.b, 0);
  if (totalA === 0 && totalB === 0) {
    return <p className="py-8 text-center text-sm text-neutral panel:text-white/55">{empty}</p>;
  }

  const max = Math.max(1, ...points.flatMap((p) => [p.a, p.b]));
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
  const colW = W / points.length;

  return (
    <figure>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${labelA}: ${totalA}; ${labelB}: ${totalB}. Pico de ${peakA.a} em ${peakA.label} e ${peakB.b} em ${peakB.label}.`}
        className={cn("w-full", className ?? "h-48")}
      >
        <g className={colorB}>
          <path d={area((p) => p.b)} className="fill-current opacity-10" />
          <path d={line((p) => p.b)} fill="none" strokeWidth={1.5} vectorEffect="non-scaling-stroke" className="stroke-current" />
        </g>
        <g className={colorA}>
          <path d={area((p) => p.a)} className="fill-current opacity-10" />
          <path d={line((p) => p.a)} fill="none" strokeWidth={1.5} vectorEffect="non-scaling-stroke" className="stroke-current" />
        </g>
        {points.map((p, i) => (
          <g key={p.key}>
            <rect x={x(i) - colW / 2} y={0} width={colW} height={H} fill="transparent" />
            <title>{`${p.label}: ${p.a} ${labelA} · ${p.b} ${labelB}`}</title>
          </g>
        ))}
      </svg>
      <figcaption className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral panel:text-white/55">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${colorA.replace("text-", "bg-")}`} aria-hidden />
            {labelA}
          </span>
          <span className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${colorB.replace("text-", "bg-")}`} aria-hidden />
            {labelB}
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
