"use client";

import { cn } from "@/lib/utils";

/**
 * Tabela de pontos + totais exibida no diálogo "Ampliar" dos gráficos. As
 * colunas variam por gráfico; a última linha é sempre o total.
 */
export function ChartTable({
  head,
  rows,
  foot,
}: {
  head: string[];
  rows: string[][];
  foot: string[];
}) {
  return (
    <table className="mt-4 w-full border-collapse text-sm">
      <thead>
        <tr className="font-mono text-micro uppercase tracking-wide text-neutral panel:text-white/55">
          {head.map((h) => (
            <th key={h} className="pb-2 text-left font-medium">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="font-mono text-xs">
        {rows.map((r) => (
          <tr key={r[0]} className="border-t border-ink/5 panel:border-white/5">
            {r.map((c, i) => (
              <td
                key={i}
                className={cn(
                  "py-1.5 tabular-nums",
                  i === 0 ? "text-neutral panel:text-white/55" : "text-ink panel:text-white",
                )}
              >
                {c}
              </td>
            ))}
          </tr>
        ))}
        <tr className="border-t border-ink/10 font-semibold panel:border-white/15">
          {foot.map((c, i) => (
            <td key={i} className="py-1.5 tabular-nums text-ink panel:text-white">
              {c}
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}
