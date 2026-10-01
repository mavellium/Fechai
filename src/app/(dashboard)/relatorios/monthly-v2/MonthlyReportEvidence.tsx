import type { MonthlyReport } from "@/modules/reports/monthly";
import { monthlyV2Evidence } from "@/modules/reports/monthly-v2-evidence";
import { STATUS_SEAL, formatCount } from "@/modules/reports/monthly-format";
import { DataTable } from "@/components/ui/data-table";
import { EvidenceDialog } from "../EvidenceDialog";

/** Conferência do snapshot no painel. Nunca importado pelo documento ou pela rota de impressão. */
export function MonthlyReportEvidence({ report }: { report: MonthlyReport }) {
  const entries = monthlyV2Evidence(report);
  if (!entries.length) return null;
  return <section aria-label="Registros do relatório mensal" className="rounded-surface border border-ink/10 p-5 panel:border-white/10 print:hidden">
    <h2 className="font-display text-lg font-semibold text-ink panel:text-white">Origem dos números do relatório</h2>
    <p className="mt-1 text-sm text-neutral panel:text-white/60">Registros da mesma leitura que compôs este relatório. Só identificadores, datas e classificações.</p>
    <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{entries.map((entry) => <li key={entry.key} className="space-y-1 rounded-control border border-ink/10 p-3 panel:border-white/10">
      <p className="text-sm font-medium text-ink panel:text-white/85">{entry.label} <span className="tabular-nums">{entry.value}</span></p>
      {entry.metric && STATUS_SEAL[entry.metric.status] && <p className="text-xs text-neutral panel:text-white/60">{STATUS_SEAL[entry.metric.status]}</p>}
      <EvidenceDialog label="Ver registros" title={entry.label} description={entry.description}>
        <div className="space-y-4">
          {entry.metric && entry.metric.value !== null && <p className="text-sm text-ink panel:text-white/85">Valor no relatório: <strong>{entry.value}</strong>.</p>}
          {entry.metric?.note && <p className="text-sm text-neutral panel:text-white/60">{entry.metric.note}</p>}
          {entry.truncated !== undefined && <p className="text-sm text-warn">A lista de origem foi limitada a 5.000 de {formatCount(entry.truncated)} registros antes deste filtro. O indicador considera todos; os registros exibidos podem não somar o valor do relatório.</p>}
          {entry.rows.length ? <DataTable caption={entry.label} head={entry.head} rows={entry.rows}
            headerAlign="left" columnAlign={entry.head.map(() => "left")} /> : <p className="text-sm text-neutral panel:text-white/60">Nenhum registro nesta lista{entry.truncated ? " limitada" : ""}.</p>}
        </div>
      </EvidenceDialog>
    </li>)}</ul>
  </section>;
}
