"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type TooltipRow = { label: string; value: string; color?: string };
export type TooltipContent = { title: string; rows: TooltipRow[] } | null;

/**
 * Balão de tooltip compartilhado — o mesmo conteúdo em hover e em foco de
 * teclado (skill dataviz, `interaction.md`: "same details on keyboard focus
 * as on hover"). Quem desenha a marca (linha, barra, célula) decide POSIÇÃO;
 * este componente só desenha o balão em si, sempre com a mesma anatomia:
 * valor em destaque, nome da série em segundo plano, chave de cor como um
 * traço curto (não uma caixa cheia — "line keys, not boxes").
 *
 * `left`/`top` são em porcentagem do container relativo (0–100), não pixels —
 * os gráficos daqui são SVG `viewBox="0 0 100 100"` esticado por CSS.
 */
export function ChartTooltip({
  content,
  left,
  top,
}: {
  content: TooltipContent;
  /** Posição horizontal, 0–100 (% do container). */
  left: number;
  /** Posição vertical, 0–100 (% do container). Padrão: perto do topo. */
  top?: number;
}) {
  if (!content) return null;

  // Perto da borda, o balão vira pra dentro em vez de vazar do card.
  const align = left > 70 ? "right" : left < 30 ? "left" : "center";
  const translate = align === "right" ? "-100%" : align === "left" ? "0%" : "-50%";

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute z-10 -translate-y-full"
      style={{ left: `${left}%`, top: `${top ?? 0}%`, transform: `translateX(${translate}) translateY(-100%)` }}
    >
      <div className="mb-2 min-w-[9rem] rounded-control border border-ink/10 bg-white px-3 py-2 shadow-lg panel:border-white/15 panel:bg-ink">
        <p className="font-mono text-micro uppercase tracking-wide text-neutral panel:text-white/55">
          {content.title}
        </p>
        <dl className="mt-1.5 space-y-1">
          {content.rows.map((row) => (
            <div key={row.label} className="flex items-center gap-2 text-xs">
              {row.color && (
                <span
                  aria-hidden
                  className="h-0.5 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: row.color }}
                />
              )}
              <dt className="min-w-0 flex-1 truncate text-neutral panel:text-white/60">{row.label}</dt>
              <dd className="shrink-0 font-mono font-semibold tabular-nums text-ink panel:text-white">
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

/** Hairline vertical do crosshair, na posição X (0–100%) do ponto ativo. */
export function ChartCrosshair({ left }: { left: number | null }) {
  if (left === null) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-y-0 w-px bg-ink/15 panel:bg-white/20"
      style={{ left: `${left}%` }}
    />
  );
}

/**
 * Camada de captura para gráficos de série (linha/barra): uma faixa
 * transparente por bucket, `pointermove`/`pointerleave` no container inteiro
 * e `:focus` por tecla (Tab) em cada faixa — a mesma leitura do hover.
 * O alvo é a faixa inteira (bem maior que 24px), não o traço fino da linha.
 */
export function ChartHoverLayer({
  count,
  active,
  onActivate,
  onLeave,
  labels,
}: {
  count: number;
  active: number | null;
  onActivate: (index: number) => void;
  onLeave: () => void;
  /** Rótulo acessível de cada faixa, para o `aria-label` do botão de foco. */
  labels: string[];
}) {
  return (
    <div className="absolute inset-0 flex" onPointerLeave={onLeave}>
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          type="button"
          tabIndex={0}
          aria-label={labels[i]}
          className={cn(
            "h-full min-w-0 flex-1 cursor-crosshair bg-transparent focus-visible:outline-none",
            active === i && "bg-ink/[0.02] panel:bg-white/[0.03]",
          )}
          onPointerMove={() => onActivate(i)}
          onFocus={() => onActivate(i)}
          onBlur={onLeave}
        />
      ))}
    </div>
  );
}
