"use client";

import { cn } from "@/lib/utils";

/**
 * Medidor de uma razão contra um teto (0-100%). Contrato do skill dataviz: o
 * preenchimento carrega a severidade (aqui sempre "bom quanto maior", um hue
 * só) e a trilha vazia é um passo mais claro do MESMO ramp — nunca cinza puro
 * — para o estado ler mesmo sem olhar o número.
 *
 * Cor nunca é o único indicador: o valor em texto sempre acompanha, e o delta
 * (quando presente) carrega seta + texto, igual ao `Stat`.
 */
export function MeterChart({
  value,
  label,
  delta,
  hint,
}: {
  /** Fração 0–1. */
  value: number;
  label: string;
  /** Variação em pontos percentuais vs. período anterior. */
  delta?: number | null;
  hint?: string;
}) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-mono text-micro uppercase tracking-[0.2em] text-neutral panel:text-white/55">{label}</p>
        <p className="font-display text-2xl font-bold tabular-nums text-ink panel:text-white">{pct}%</p>
      </div>
      <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-iris/15 panel:bg-iris/20">
        <div className="h-full rounded-full bg-iris transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      {delta !== undefined && delta !== null && (
        <p
          className={cn(
            "mt-1.5 text-xs",
            delta > 0 ? "text-success" : delta < 0 ? "text-warn" : "text-neutral panel:text-white/55",
          )}
        >
          <span aria-hidden>{delta > 0 ? "↑" : delta < 0 ? "↓" : "="}</span>{" "}
          {delta === 0 ? "igual ao período anterior" : `${Math.abs(Math.round(delta * 100))}pp vs. período anterior`}
        </p>
      )}
      {hint && <p className="mt-1 text-xs text-neutral panel:text-white/55">{hint}</p>}
    </div>
  );
}
