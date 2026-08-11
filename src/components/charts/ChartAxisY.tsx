"use client";

/**
 * Três gridlines horizontais (0, meio, máx) + rótulo do valor em cada uma —
 * hairline sólido, um tom acima da superfície (nunca tracejado: skill dataviz,
 * anti-padrões). Sobrepõe o desenho do gráfico como uma camada absoluta; quem
 * chama posiciona o container com `position: relative`.
 *
 * `max` já deve ser o valor arredondado do eixo (não o pico bruto) — cada
 * gráfico decide o arredondamento porque a escala de "conversas" e "R$" pedem
 * passos diferentes.
 */
export function ChartAxisY({ max, formatValue = String }: { max: number; formatValue?: (v: number) => string }) {
  const steps = [max, max / 2, 0];
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {steps.map((v, i) => (
        <div
          key={i}
          className="absolute inset-x-0 flex items-center"
          style={{ top: `${(i / (steps.length - 1)) * 100}%` }}
        >
          <span className="-translate-y-1/2 pr-2 font-mono text-[10px] tabular-nums text-neutral panel:text-white/40">
            {formatValue(v)}
          </span>
          <div className="h-px flex-1 bg-ink/8 panel:bg-white/10" />
        </div>
      ))}
    </div>
  );
}

/** Arredonda um pico bruto para um valor de eixo "limpo" (1, 2, 5 × 10^n). */
export function niceAxisMax(rawMax: number): number {
  if (rawMax <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(rawMax));
  const normalized = rawMax / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}
