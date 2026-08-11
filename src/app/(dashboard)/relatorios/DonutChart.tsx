"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { chartColor } from "@/components/charts/palette";
import { ChartTooltip } from "@/components/charts/ChartTooltip";

/**
 * Distribuição de conversas por agente, como rosca.
 *
 * Círculos com `stroke-dasharray` — o traço do círculo vira o segmento da fatia.
 * Limite de 5 segmentos visíveis: além disso o restante vira "Outros", senão a
 * legenda vira um catálogo. Tooltip por fatia no hover/foco; resumo em texto
 * para leitor de tela no `role="img"`.
 *
 * Paleta validada em `src/components/charts/palette.ts` (script do skill
 * dataviz — ALL CHECKS PASS claro e escuro). Cor por NOME, não por posição no
 * array: `slices` chega ordenado por contagem — se a ordem mudar de um
 * carregamento para o outro, o agente não pode trocar de cor.
 */
const GAP_DEG = 3; // abertura de superfície entre fatias — nunca uma borda desenhada
const R = 15.915; // raio que fecha a circunferência em ~100 unidades
const C = 2 * Math.PI * R;
const GAP_LEN = (GAP_DEG / 360) * C;

export function DonutChart({
  slices,
  className,
}: {
  slices: { name: string; count: number }[];
  /** Tamanho da rosca — o padrão é compacto no card; tela cheia passa maior. */
  className?: string;
}) {
  const [active, setActive] = useState<string | null>(null);

  const total = slices.reduce((s, x) => s + x.count, 0);
  if (total === 0) {
    return <p className="py-8 text-center text-sm text-neutral panel:text-white/55">Nenhuma conversa no período.</p>;
  }

  const extra = slices.slice(4).reduce((s, x) => s + x.count, 0);
  const shown = slices.slice(0, 4);
  const segments = [...shown, ...(extra > 0 ? [{ name: "Outros", count: extra }] : [])];
  const names = [...new Set(segments.map((s) => s.name))];

  let acc = 0;
  const withOffset = segments.map((s) => {
    const frac = s.count / total;
    const raw = frac * C;
    const dash = Math.max(0, raw - GAP_LEN);
    const seg = { ...s, color: chartColor(names.indexOf(s.name)), dash, offset: -acc * C };
    acc += frac;
    return seg;
  });

  const summary =
    total === 0
      ? "Nenhuma conversa no período."
      : `${total} conversas: ${segments.map((s) => `${s.name} ${s.count}`).join(", ")}.`;

  const activeSeg = withOffset.find((s) => s.name === active) ?? null;

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row">
      <div className={cn("relative shrink-0", className ?? "h-36 w-36")} onPointerLeave={() => setActive(null)}>
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
              strokeWidth={active === s.name ? 4.5 : 3.5}
              strokeDasharray={`${s.dash} ${C - s.dash}`}
              strokeDashoffset={s.offset}
              strokeLinecap="butt"
              className="cursor-default transition-[stroke-width] focus-visible:outline-none"
              tabIndex={0}
              role="button"
              aria-label={`${s.name}: ${s.count} conversas, ${Math.round((s.count / total) * 100)}%`}
              onPointerMove={() => setActive(s.name)}
              onFocus={() => setActive(s.name)}
              onBlur={() => setActive(null)}
            >
              <title>{`${s.name}: ${s.count} conversas`}</title>
            </circle>
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-2xl font-bold tabular-nums text-ink panel:text-white">{total}</span>
          <span className="text-xs text-neutral panel:text-white/55">conversas</span>
        </div>
        {activeSeg && (
          <ChartTooltip
            left={50}
            top={0}
            content={{
              title: activeSeg.name,
              rows: [{ label: "Conversas", value: `${activeSeg.count} · ${Math.round((activeSeg.count / total) * 100)}%`, color: activeSeg.color }],
            }}
          />
        )}
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
