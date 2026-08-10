"use client";

import { cn } from "@/lib/utils";

/**
 * Distribuição de conversas por agente, como rosca.
 *
 * Círculos com `stroke-dasharray` — o traço do círculo vira o segmento da fatia.
 * Limite de 5 segmentos visíveis: além disso o restante vira "Outros", senão a
 * legenda vira um catálogo. Tooltip nativo por fatia; resumo em texto para
 * leitor de tela no `role="img"`.
 *
 * Paleta restrita aos tokens de marca (iris/success/warn/signal + um neutro).
 */
const PALETTE = ["#4b3cf0", "#1fc8a3", "#f59e0b", "#ff6b4a", "#94a3b8"];
const R = 15.915; // raio que fecha a circunferência em ~100 unidades
const C = 2 * Math.PI * R;

export function DonutChart({
  slices,
  className,
}: {
  slices: { name: string; count: number }[];
  /** Tamanho da rosca — o padrão é compacto no card; tela cheia passa maior. */
  className?: string;
}) {
  const total = slices.reduce((s, x) => s + x.count, 0);
  if (total === 0) {
    return <p className="py-8 text-center text-sm text-neutral panel:text-white/55">Nenhuma conversa no período.</p>;
  }

  const extra = slices.slice(4).reduce((s, x) => s + x.count, 0);
  const shown = slices.slice(0, 4);
  const segments = [...shown, ...(extra > 0 ? [{ name: "Outros", count: extra }] : [])];

  let acc = 0;
  const withOffset = segments.map((s, i) => {
    const frac = s.count / total;
    const seg = { ...s, color: PALETTE[i], dash: frac * C, offset: -acc * C };
    acc += frac;
    return seg;
  });

  const summary =
    total === 0
      ? "Nenhuma conversa no período."
      : `${total} conversas: ${segments.map((s) => `${s.name} ${s.count}`).join(", ")}.`;

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row">
      <div className={cn("relative shrink-0", className ?? "h-36 w-36")}>
        <svg viewBox="0 0 42 42" role="img" aria-label={summary} className="h-full w-full -rotate-90">
          <circle cx="21" cy="21" r={R} fill="none" strokeWidth={3.5} className="stroke-ink/5 panel:stroke-white/10" />
          {withOffset.map((s) => (
            <circle
              key={s.name}
              cx="21"
              cy="21"
              r={R}
              fill="none"
              stroke={s.color}
              strokeWidth={3.5}
              strokeDasharray={`${s.dash} ${C - s.dash}`}
              strokeDashoffset={s.offset}
              strokeLinecap="butt"
            >
              <title>{`${s.name}: ${s.count} conversas`}</title>
            </circle>
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-2xl font-bold tabular-nums text-ink panel:text-white">{total}</span>
          <span className="text-xs text-neutral panel:text-white/55">conversas</span>
        </div>
      </div>
      <ul className="w-full min-w-0 space-y-2">
        {withOffset.map((s) => (
          <li key={s.name} className="flex items-center gap-2 text-sm">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
            <span className="min-w-0 truncate text-ink panel:text-white">{s.name}</span>
            <span className="ml-auto shrink-0 font-mono text-xs tabular-nums text-neutral panel:text-white/55">
              {s.count} · {Math.round((s.count / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
