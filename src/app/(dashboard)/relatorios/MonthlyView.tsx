import { formatBRL } from "@/lib/format";
import type { MonthlyReport, SplitCount } from "@/modules/reports/monthly";
import { Card, CardTitle } from "@/components/ui/card";

export const total = (s: SplitCount) => s.inside + s.outside + s.unclassified;
const number = (v: number | null, suffix = "") => v === null ? "Pendente" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}${suffix}`;
const money = (v: number | null) => v === null ? "Pendente" : formatBRL(v);
export function monthlyRows(r: MonthlyReport) {
  const a = r.current, b = r.previous;
  return [
    ["Novos contatos atendidos", number(a.newContacts), number(b.newContacts)],
    ["Conversas · dentro / fora", r.assumptions.humanHours ? `${a.conversations.inside} / ${a.conversations.outside}` : `Pendente (${total(a.conversations)} no total)`, r.previousAssumptions.humanHours ? `${b.conversations.inside} / ${b.conversations.outside}` : `Pendente (${total(b.conversations)} no total)`],
    ["Primeira resposta média", number(a.firstResponseSeconds, " s"), number(b.firstResponseSeconds, " s")],
    ["Leads qualificados", `${a.qualified}${a.trackingComplete ? "" : " registrados*"}`, `${b.qualified}${b.trackingComplete ? "" : " registrados*"}`],
    ["Avaliações agendadas · dentro / fora", r.assumptions.humanHours ? `${a.scheduled.inside} / ${a.scheduled.outside}` : "Pendente", r.previousAssumptions.humanHours ? `${b.scheduled.inside} / ${b.scheduled.outside}` : "Pendente"],
    ["Avaliações realizadas · dentro / fora", r.assumptions.humanHours ? `${a.attended.inside} / ${a.attended.outside}` : "Pendente", r.previousAssumptions.humanHours ? `${b.attended.inside} / ${b.attended.outside}` : "Pendente"],
    ["Transbordos para humano", `${a.handoffs}${a.trackingComplete ? "" : " registrados*"}`, `${b.handoffs}${b.trackingComplete ? "" : " registrados*"}`],
    ["Perguntas sem resposta", `${a.unanswered}${a.trackingComplete ? "" : " registradas*"}`, `${b.unanswered}${b.trackingComplete ? "" : " registradas*"}`],
    ["Horas assumidas (estimadas)", number(a.assumedHours, " h"), number(b.assumedHours, " h")],
    ["ROI estimado", number(a.roiPercent, "%"), number(b.roiPercent, "%")],
  ];
}
export function MonthlyView({ report: r }: { report: MonthlyReport }) {
  const a = r.current, c = r.assumptions;
  const days = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const time = (v: number) => `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
  return <div className="space-y-6">
    <Card>
      <p className="text-xs uppercase tracking-widest text-neutral panel:text-white/55">1 · ROI estimado · {r.label}{r.partial ? " · prévia do mês em andamento" : ""}</p>
      <p className="my-4 font-display text-5xl font-semibold text-ink panel:text-white">{number(a.roiPercent, "%")}</p>
      <div className="grid gap-4 sm:grid-cols-3 text-sm">
        <p>Receita estimada<br /><strong>{money(a.revenueCents)}</strong></p>
        <p>Economia estimada<br /><strong>{money(a.savingsCents)}</strong></p>
        <p>Investimento mensal<br /><strong>{money(a.investmentCents)}</strong></p>
      </div>
      <p className="mt-4 text-sm text-neutral panel:text-white/65">Receita = avaliações realizadas de contatos que chegaram fora do horário humano × conversão × ticket de cada procedimento. Economia = horas assumidas × custo/hora. ROI = (receita + economia − investimento) ÷ investimento.</p>
      {a.investmentCents === 0 && <p className="mt-2 text-sm">Mensalidade zero: ROI percentual não se aplica.</p>}
      {a.missing.length > 0 && <ul className="mt-3 list-disc pl-5 text-sm text-warn">{a.missing.map((m) => <li key={m}>{m}</li>)}</ul>}
    </Card>
    <Card>
      <CardTitle>2 · O que aconteceu no mês</CardTitle>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm">
        <thead><tr className="border-b border-ink/10 panel:border-white/10"><th className="py-3">Indicador</th><th>Este mês</th><th>{r.previousMonth}</th></tr></thead>
        <tbody>{monthlyRows(r).map(([label, value, previous]) => <tr key={label} className="border-b border-ink/5 panel:border-white/5"><td className="py-2 pr-3">{label}</td><td className="pr-3 tabular-nums">{value}</td><td className="tabular-nums text-neutral panel:text-white/55">{previous}</td></tr>)}</tbody>
      </table></div>
      {!a.trackingComplete && <p className="mt-3 text-xs text-warn">* Qualificação, transbordos e perguntas sem resposta têm cobertura parcial: apenas eventos explícitos registrados após a implantação. Ausência de registro histórico não significa zero ocorrências.</p>}
      {!r.previousConfigured && <p className="mt-2 text-xs text-neutral panel:text-white/55">Mês anterior sem premissas: os totais operacionais são comparáveis; classificações de horário e valores financeiros estão pendentes.</p>}
      <p className="mt-2 text-xs text-neutral panel:text-white/55">Sem classificação de horário: {a.conversations.unclassified} conversas, {a.scheduled.unclassified} agendadas e {a.attended.unclassified} realizadas. Comparecimento pendente: {a.attendanceUnknown}. Agendamentos sem tipo: {a.untypedAppointments}.</p>
      {r.clinicorpError && <p className="mt-2 text-xs text-warn">{r.clinicorpError}</p>}
    </Card>
    <Card>
      <CardTitle>3 · Destaques</CardTitle>
      <div className="grid gap-4 md:grid-cols-2">
        <div><p className="mb-2 text-sm font-medium">Procedimentos</p>{a.procedures.length ? a.procedures.map((p) => <p key={p.name} className="py-1 text-sm">{p.name}: {p.qualified} qualificados · {p.attendedOutside} avaliações realizadas fora · {money(p.revenueCents)}</p>) : <p className="text-sm text-neutral panel:text-white/55">Sem procedimento registrado no período.</p>}</div>
        <div><p className="mb-2 text-sm font-medium">Horários de pico</p>{a.peaks.map((p) => <p key={p.hour} className="py-1 text-sm">{String(p.hour).padStart(2, "0")}h: {p.messages} mensagens recebidas</p>)}<p className="mt-2 text-xs text-neutral panel:text-white/55">Fuso: {c.timezone}</p></div>
      </div>
    </Card>
    <div className="grid gap-6 md:grid-cols-2">
      <Card><CardTitle>4 · O que ajustamos no agente</CardTitle><p className="whitespace-pre-wrap text-sm">{r.adjustments || "Aguardando revisão da Mavellium."}</p></Card>
      <Card><CardTitle>5 · Próximo mês</CardTitle><p className="whitespace-pre-wrap text-sm">{r.nextMonth || "Aguardando plano da Mavellium."}</p></Card>
    </div>
    <Card><CardTitle>Premissas visíveis</CardTitle>
      <p className="text-sm">Custo do atendente: {money(c.attendantMonthlyCents)} / mês · carga: {number(c.attendantMonthlyHours, " h")} · custo/hora: {c.attendantMonthlyCents !== null && c.attendantMonthlyHours ? money(Math.round(c.attendantMonthlyCents / c.attendantMonthlyHours)) : "Pendente"}.</p>
      <p className="mt-2 text-sm">Horas estimadas: {a.aiOnlyConversations} conversas respondidas pelo agente sem resposta humana no mês × {number(c.minutesPerConversation, " minutos")} ÷ 60. Essa estimativa não mede tempo de execução da IA.</p>
      <div className="my-3 text-sm">{c.humanHours ? c.humanHours.map((hours, i) => <p key={i}>{days[i]}: {hours.length ? hours.map((h) => `${time(h.start)}–${time(h.end)}`).join(", ") : "fechado"}</p>) : "Horário humano pendente."}</div>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>Procedimento</th><th>Ticket médio</th><th>Conversão</th></tr></thead><tbody>{c.procedures.map((p) => <tr key={p.name}><td className="py-2">{p.name}</td><td>{money(p.ticketCents)}</td><td>{number(p.conversionBps === null ? null : p.conversionBps / 100, "%")}</td></tr>)}</tbody></table></div>
      <p className="mt-3 text-xs text-neutral panel:text-white/55">Tipos considerados avaliações: {c.evaluationTypes.join(", ")}. Sem tipo: {c.countUntypedAsEvaluations ? "considerados avaliações por confirmação da Mavellium" : "aguardam classificação"}. Variável de procedimento: {c.procedureVariable || "não definida"}. Status de comparecimento no Clinicorp: {c.completedStatusTypes.join(", ") || "não definidos"}.</p>
      <p className="mt-2 text-xs text-neutral panel:text-white/55">Conversas: primeira interação respondida no mês, separada pela chegada dessa interação. Avaliações: origem pela primeira mensagem do contato, anteriores à marcação; agendadas pela criação, realizadas pela data da consulta. Canceladas, testes e marcações manuais ficam fora. Primeira resposta: um par recebido/respondido por conversa no mês, incluindo respostas humanas. Qualificado = evento explícito de lead quente; sem inferência de texto.</p>
    </Card>
  </div>;
}
