import type { ReactNode } from "react";

/** Tabela de leitura do painel, com contraste, números alinhados e rolagem em telas pequenas. */
export function DataTable({ head, rows, caption }: {
  head: string[];
  rows: { id: string; cells: ReactNode[] }[];
  caption: string;
}) {
  return <div className="overflow-x-auto"><table className="w-full border-collapse text-sm">
    <caption className="sr-only">{caption}</caption>
    <thead><tr className="border-b border-ink/10 text-neutral panel:border-white/15 panel:text-white/55">{head.map((label, i) => <th key={i} scope="col" className={`px-3 pb-3 font-medium ${i === 0 ? "pl-0 text-left" : "text-right"}`}>{label}</th>)}</tr></thead>
    <tbody className="text-ink panel:text-white/85">{rows.map(({ id, cells }) => <tr key={id} className="border-b border-ink/5 last:border-0 panel:border-white/5">{cells.map((cell, i) => i === 0 ? <th key={i} scope="row" className="py-3 pr-6 text-left font-medium">{cell}</th> : <td key={i} className="px-3 py-3 text-right tabular-nums">{cell}</td>)}</tr>)}</tbody>
  </table></div>;
}
