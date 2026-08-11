"use client";

import { Fragment, useState } from "react";
import { cn } from "@/lib/utils";
import { ChartTooltip } from "./ChartTooltip";

export type HeatmapCell = { weekday: number; hour: number; count: number };

const WEEKDAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/**
 * Horários de pico: mensagens do lead por dia da semana × hora, como grade de
 * calor. Magnitude (comparar volume) → sequencial de UM hue só, mais escuro é
 * mais mensagens (skill dataviz: nunca arco-íris num heatmap de magnitude).
 * A célula com hover ganha um anel de 2px na cor da superfície, não uma
 * borda desenhada — mesmo espaçador que separa marcas adjacentes.
 */
export function HeatmapChart({ cells, className }: { cells: HeatmapCell[]; className?: string }) {
  const [active, setActive] = useState<HeatmapCell | null>(null);

  const max = Math.max(1, ...cells.map((c) => c.count));
  const total = cells.reduce((s, c) => s + c.count, 0);
  if (total === 0) {
    return <p className="py-8 text-center text-sm text-neutral panel:text-white/55">Nenhuma mensagem no período.</p>;
  }

  const peak = cells.reduce((best, c) => (c.count > best.count ? c : best), cells[0]);
  const summary = `${total} mensagens do lead no período. Pico às ${peak.hour}h de ${WEEKDAY_LABELS[peak.weekday]}, com ${peak.count} mensagens.`;

  const byKey = new Map(cells.map((c) => [`${c.weekday}-${c.hour}`, c]));
  const opacityFor = (count: number) => (count === 0 ? 0 : 0.15 + (count / max) * 0.85);

  return (
    <figure className={className}>
      <div role="img" aria-label={summary} className="overflow-x-auto">
        <div className="inline-grid min-w-full grid-cols-[2.5rem_repeat(24,minmax(1.25rem,1fr))] gap-[2px]">
          <div />
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="text-center font-mono text-[9px] tabular-nums text-neutral panel:text-white/40">
              {h % 3 === 0 ? h : ""}
            </div>
          ))}
          {WEEKDAY_LABELS.map((label, weekday) => (
            <Fragment key={weekday}>
              <div className="flex items-center pr-2 font-mono text-[10px] text-neutral panel:text-white/55">
                {label}
              </div>
              {Array.from({ length: 24 }, (_, hour) => {
                const cell = byKey.get(`${weekday}-${hour}`) ?? { weekday, hour, count: 0 };
                const isActive = active?.weekday === weekday && active?.hour === hour;
                return (
                  <button
                    key={`${weekday}-${hour}`}
                    type="button"
                    tabIndex={0}
                    aria-label={`${WEEKDAY_LABELS[weekday]}, ${hour}h: ${cell.count} mensagens`}
                    className={cn(
                      "aspect-square min-h-[1.1rem] rounded-[2px] bg-iris transition-[outline] focus-visible:outline-none",
                      isActive && "ring-2 ring-iris ring-offset-1 ring-offset-white panel:ring-offset-ink",
                    )}
                    style={{ opacity: opacityFor(cell.count) }}
                    onPointerMove={() => setActive(cell)}
                    onPointerLeave={() => setActive(null)}
                    onFocus={() => setActive(cell)}
                    onBlur={() => setActive(null)}
                  />
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
      {active && active.count > 0 && (
        <ChartTooltip
          left={50}
          top={0}
          content={{
            title: `${WEEKDAY_LABELS[active.weekday]}, ${active.hour}h`,
            rows: [{ label: "Mensagens", value: String(active.count), color: "var(--color-iris)" }],
          }}
        />
      )}
      <figcaption className="mt-3 flex items-center justify-between gap-2 text-xs text-neutral panel:text-white/55">
        <span>Pico: {WEEKDAY_LABELS[peak.weekday]} às {peak.hour}h ({peak.count})</span>
        <span className="flex items-center gap-1.5">
          menos
          <span className="flex gap-0.5" aria-hidden>
            {[0.2, 0.4, 0.6, 0.8, 1].map((o) => (
              <span key={o} className="h-2.5 w-2.5 rounded-[2px] bg-iris" style={{ opacity: o }} />
            ))}
          </span>
          mais
        </span>
      </figcaption>
    </figure>
  );
}
