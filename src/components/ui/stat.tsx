import * as React from "react";
import { cn } from "@/lib/utils";

/** Número grande de relatório. Mesma casca do `Card`, sem título de seção. */
export function Stat({
  label,
  value,
  hint,
  delta,
  compact,
}: {
  label: string;
  value: string;
  hint?: string;
  /**
   * Variação contra o período anterior. Um número sozinho ("34 conversas") não
   * diz se a semana foi boa; comparado, diz. Seta **e** texto — cor nunca é o
   * único indicador (skill design-ui, §4).
   */
  delta?: number;
  /** Versão de grade densa (home), com número menor. */
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-surface border border-ink/10 bg-white panel:border-white/10 panel:bg-white/5",
        compact ? "p-4" : "p-6",
      )}
    >
      <p className="font-mono text-micro uppercase tracking-[0.2em] text-neutral panel:text-white/55">
        {label}
      </p>
      {/* tabular-nums: os números não "pulam" de largura quando o valor muda */}
      <p
        className={cn(
          "font-display mt-2 font-bold tabular-nums text-ink panel:text-white",
          compact ? "text-3xl" : "text-4xl",
        )}
      >
        {value}
      </p>
      {delta !== undefined && (
        <p
          className={cn(
            "mt-1 text-xs",
            delta > 0
              ? "text-success"
              : delta < 0
                ? "text-warn"
                : "text-neutral panel:text-white/55",
          )}
        >
          <span aria-hidden>{delta > 0 ? "↑" : delta < 0 ? "↓" : "="}</span>{" "}
          {delta === 0 ? "igual ao período anterior" : `${Math.abs(delta)} vs. período anterior`}
        </p>
      )}
      {hint && <p className="mt-1 text-xs text-neutral panel:text-white/55">{hint}</p>}
    </div>
  );
}
