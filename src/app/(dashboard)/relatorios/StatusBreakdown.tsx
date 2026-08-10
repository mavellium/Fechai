"use client";

import { ChartActions } from "@/components/charts/ChartActions";
import { ChartTable } from "@/components/charts/ChartTable";
import { leadStatusLabel } from "../conversas/leadStatus";

const TONE_COLOR: Record<string, string> = {
  neutral: "bg-neutral",
  warn: "bg-warn",
  danger: "bg-danger",
  success: "bg-success",
  iris: "bg-iris",
};

/**
 * Distribuição dos leads novos por status, com barra proporcional, e as mesmas
 * ações dos gráficos (ampliar + origem dos dados) num canto próprio — o título
 * "Leads por status" já é do card.
 */
export function StatusBreakdown({ data }: { data: { status: string; count: number }[] }) {
  const total = data.reduce((s, x) => s + x.count, 0);
  if (total === 0) {
    return <p className="py-8 text-center text-sm text-neutral panel:text-white/55">Nenhum lead novo no período.</p>;
  }

  const rows = data.map((d) => {
    const meta = leadStatusLabel(d.status);
    return [meta.label, String(d.count), `${Math.round((d.count / total) * 100)}%`];
  });

  const list = (
    <ul className="space-y-3">
      {data.map((d) => {
        const meta = leadStatusLabel(d.status);
        return (
          <li key={d.status}>
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${TONE_COLOR[meta.tone]}`} aria-hidden />
                <span className="text-ink panel:text-white">{meta.label}</span>
              </span>
              <span className="shrink-0 font-mono text-xs tabular-nums text-neutral panel:text-white/55">
                {d.count} · {Math.round((d.count / total) * 100)}%
              </span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-ink/5 panel:bg-white/10">
              <div className={`h-full rounded-full ${TONE_COLOR[meta.tone]}`} style={{ width: `${(d.count / total) * 100}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <ChartActions
          label="leads por status"
          title="Leads por status"
          hint={`${total} leads novos no período.`}
          description="Leads novos criados no período, agrupados pelo status atual (Novo, Morno, Quente, Agendado, Perdido). Conversas do sandbox de teste não contam."
          sources={[
            ["Leads novos no período", String(total)],
            ["Status distintos", String(data.length)],
            ["Testes (sandbox)", "excluídos"],
          ]}
          full={
            <>
              {list}
              <ChartTable head={["Status", "Leads", "Participação"]} rows={rows} foot={["Total", String(total), "100%"]} />
            </>
          }
        />
      </div>
      {list}
    </div>
  );
}
