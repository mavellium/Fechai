"use client";
import { useState } from "react";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, fieldProps } from "@/components/ui/field";
import { CardTitle } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { MonthlyReport, MonthlyMetrics } from "@/modules/reports/monthly";
import type { MonthlyOverrides, MonthlyMetricOverrides } from "@/modules/reports/monthly-overrides";

function fieldValue(source: MonthlyMetrics | MonthlyMetricOverrides, path: string): number | null | undefined {
  const [key, child] = path.split(".");
  const record = source as unknown as Record<string, number | null | Record<string, number> | undefined>;
  return child ? (record[key] as Record<string, number> | undefined)?.[child] : record[key] as number | null | undefined;
}
function updateField(source: MonthlyMetricOverrides, path: string, value: number | null | undefined): MonthlyMetricOverrides {
  const [key, child] = path.split(".");
  const result = { ...source } as Record<string, unknown>;
  if (child) {
    const nested = { ...result[key] as Record<string, unknown> };
    if (value === undefined) delete nested[child]; else nested[child] = value;
    if (Object.keys(nested).length) result[key] = nested; else delete result[key];
  } else if (value === undefined) delete result[key]; else result[key] = value;
  return result as MonthlyMetricOverrides;
}
const display = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? "" : String(Math.round(value * 100) / 100).replace(".", ",");

export function MonthlyMetricFields({ report: r, value, onChange }: {
  report: MonthlyReport; value: MonthlyOverrides; onChange: (next: MonthlyOverrides) => void;
}) {
  const [period, setPeriod] = useState<"current" | "previous">("current");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const auto = r.automatic?.[period] ?? r[period];
  const overrides = value[period];
  const set = (next: MonthlyMetricOverrides) => onChange({ ...value, [period]: next });
  const rows = overrides.procedures ?? auto.procedures;
  const peaks = overrides.peaks ?? auto.peaks;
  const input = (path: string, label: string, nullable = false) => {
    const custom = fieldValue(overrides, path);
    const id = `metric-${period}-${path}`;
    return <Field key={path} htmlFor={id} label={label} hint={custom !== undefined ? "Ajustado manualmente" : "Dado carregado"}>
      <div className="flex items-center gap-1"><Input {...fieldProps(id, { hint: true })} name={id} inputMode={nullable ? "decimal" : "numeric"} value={drafts[id] ?? display(custom !== undefined ? custom : fieldValue(auto, path))} placeholder="Não medido" onChange={(e) => { setDrafts({ ...drafts, [id]: e.target.value }); set(updateField(overrides, path, e.target.value.trim() === "" ? nullable ? null : NaN : Number(e.target.value.replace(",", ".")))); }} />
        {custom !== undefined && <Button type="button" size="icon" variant="ghost" aria-label={`Restaurar dado automático: ${label}`} onClick={() => { const next = { ...drafts }; delete next[id]; setDrafts(next); set(updateField(overrides, path, undefined)); }}><RotateCcw size={14} aria-hidden /></Button>}
      </div>
    </Field>;
  };
  return <section className="space-y-5">
    <CardTitle as="h3" hint="Os campos já vêm preenchidos. Altere os dados conferidos com a clínica; receita, economia e ROI são recalculados ao salvar.">Dados do relatório</CardTitle>
    <SegmentedControl value={period} onSelect={setPeriod} label="Mês dos indicadores" options={[{ value: "current", label: r.month.split("-").reverse().join("/") }, { value: "previous", label: `Anterior · ${r.previousMonth.split("-").reverse().join("/")}` }]} />
    <input type="hidden" name="metricOverrides" value={JSON.stringify(value)} />
    <div className="grid items-end gap-5 sm:grid-cols-2 xl:grid-cols-4">
      {input("newContacts", "Novos contatos atendidos")}{input("firstResponseSeconds", "Primeira resposta média (s)", true)}
      {input("qualified", "Leads qualificados")}{input("handoffs", "Transbordos para humano")}{input("unanswered", "Perguntas sem resposta")}
      {input("aiOnlyConversations", "Conversas sem resposta humana")}{input("assumedHours", "Horas assumidas pelo agente (h)", true)}
    </div>
    {([ ["conversations", "Conversas atendidas"], ["scheduled", "Avaliações agendadas pelo agente"], ["attended", "Avaliações realizadas"] ] as const).map(([key, label]) => <div key={key} className="space-y-3 border-t border-ink/10 pt-4 panel:border-white/10"><h4 className="text-sm font-medium">{label}</h4><div className="grid gap-5 sm:grid-cols-3">
      {input(`${key}.inside`, `${label} · dentro do horário`)}{input(`${key}.outside`, `${label} · fora do horário`)}{input(`${key}.unclassified`, `${label} · sem classificação`)}
    </div></div>)}
    <div className="grid gap-5 sm:grid-cols-2">{input("attendanceUnknown", "Avaliações com presença pendente")}{input("untypedAppointments", "Agendamentos sem tipo")}</div>
    <div className="space-y-4 border-t border-ink/10 pt-5 panel:border-white/10"><CardTitle as="h3" hint="As realizadas fora do horário devem somar o total informado acima.">Indicadores por procedimento</CardTitle>
      {rows.map((p, i) => <div key={i} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
        <Field label="Nome do procedimento" htmlFor={`data-procedure-${period}-${i}`}><Input {...fieldProps(`data-procedure-${period}-${i}`)} name={`data-procedure-${period}-${i}`} value={p.name} maxLength={60} onChange={(e) => set({ ...overrides, procedures: rows.map((row, j) => ({ name: j === i ? e.target.value : row.name, qualified: row.qualified, attendedOutside: row.attendedOutside })) })} /></Field>
        {(["qualified", "attendedOutside"] as const).map((key) => <Field key={key} label={key === "qualified" ? "Qualificados por procedimento" : "Realizadas fora por procedimento"} htmlFor={`data-${period}-${key}-${i}`}><Input {...fieldProps(`data-${period}-${key}-${i}`)} name={`data-${period}-${key}-${i}`} inputMode="numeric" value={display(p[key])} onChange={(e) => set({ ...overrides, procedures: rows.map((row, j) => ({ name: row.name, qualified: row.qualified, attendedOutside: row.attendedOutside, ...(j === i ? { [key]: e.target.value === "" ? NaN : Number(e.target.value) } : {}) })) })} /></Field>)}
        <Button type="button" size="icon" variant="ghost" aria-label={`Remover indicadores de ${p.name || "procedimento"}`} onClick={() => set({ ...overrides, procedures: rows.filter((_, j) => j !== i).map(({ name, qualified, attendedOutside }) => ({ name, qualified, attendedOutside })) })}><Trash2 size={15} aria-hidden /></Button>
      </div>)}
      <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" disabled={rows.length >= 40} onClick={() => set({ ...overrides, procedures: [...rows.map(({ name, qualified, attendedOutside }) => ({ name, qualified, attendedOutside })), { name: "", qualified: 0, attendedOutside: 0 }] })}><Plus size={14} aria-hidden />Indicadores de procedimento</Button>{overrides.procedures && <Button type="button" size="sm" variant="ghost" onClick={() => { const next = { ...overrides }; delete next.procedures; set(next); }}><RotateCcw size={14} aria-hidden />Restaurar procedimentos</Button>}</div>
    </div>
    <div className="space-y-4 border-t border-ink/10 pt-5 panel:border-white/10"><CardTitle as="h3">Horários de pico</CardTitle>{peaks.map((p, i) => <div key={i} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
      {(["hour", "messages"] as const).map((key) => <Field key={key} label={key === "hour" ? "Hora local (0 a 23)" : "Mensagens no horário de pico"} htmlFor={`peak-${period}-${key}-${i}`}><Input {...fieldProps(`peak-${period}-${key}-${i}`)} name={`peak-${period}-${key}-${i}`} inputMode="numeric" value={display(p[key])} onChange={(e) => set({ ...overrides, peaks: peaks.map((row, j) => j === i ? { ...row, [key]: e.target.value === "" ? NaN : Number(e.target.value) } : row) })} /></Field>)}
      <Button type="button" size="icon" variant="ghost" aria-label={`Remover pico ${i + 1}`} onClick={() => set({ ...overrides, peaks: peaks.filter((_, j) => j !== i) })}><Trash2 size={15} aria-hidden /></Button>
    </div>)}<div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" disabled={peaks.length >= 3} onClick={() => set({ ...overrides, peaks: [...peaks, { hour: 0, messages: 0 }] })}><Plus size={14} aria-hidden />Horário de pico</Button>{overrides.peaks && <Button type="button" size="sm" variant="ghost" onClick={() => { const next = { ...overrides }; delete next.peaks; set(next); }}><RotateCcw size={14} aria-hidden />Restaurar picos</Button>}</div></div>
  </section>;
}
