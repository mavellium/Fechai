import { formatBRL } from "@/lib/format";
import type { MonthlyReport, SplitCount } from "@/modules/reports/monthly";
import { Card, CardTitle } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { DataTable } from "@/components/ui/data-table";
import { TIMEZONES } from "@/modules/scheduling/time";

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
export function MonthlyRoiSummary({ report: r }: { report: MonthlyReport }) {
  const a = r.current;
  return <section className="space-y-4" aria-label="Retorno do mês">
    <div className="flex flex-wrap items-center gap-3"><h2 className="font-display text-lg font-semibold text-ink panel:text-white">Retorno de {r.label}</h2><Badge tone="neutral">Valores estimados</Badge>{r.partial && <Badge tone="warn">Mês em andamento</Badge>}</div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Stat label="ROI do mês" value={number(a.roiPercent, "%")} hint={a.roiPercent === null ? "aguardando premissas" : "retorno sobre o investimento"} />
      <Stat compact label="Receita estimada" value={money(a.revenueCents)} hint="contatos que chegaram fora do expediente" />
      <Stat compact label="Economia estimada" value={money(a.savingsCents)} hint="horas assumidas pelo agente" />
      <Stat compact label="Investimento mensal" value={money(a.investmentCents)} hint="mensalidade do Fechai" />
    </div>
    <p className="text-sm leading-relaxed text-neutral panel:text-white/60">A receita considera as avaliações realizadas de contatos que chegaram fora do horário humano. A economia estima o tempo de atendimento assumido pelo agente.</p>
    {a.investmentCents === 0 && <Alert>Mensalidade zero: o ROI percentual não se aplica.</Alert>}
    {a.missing.length > 0 && <Alert tone="warn" title="Dados pendentes para calcular o retorno"><ul className="mt-1 list-disc space-y-1 pl-4">{a.missing.map((m) => <li key={m}>{m}</li>)}</ul></Alert>}
  </section>;
}

export function MonthlyView({ report: r, showSummary = true }: { report: MonthlyReport; showSummary?: boolean }) {
  const a = r.current, c = r.assumptions;
  const days = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const time = (v: number) => `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
  const previousLabel = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${r.previousMonth}-01T12:00:00Z`));
  return <div className="space-y-6 text-ink panel:text-white/85">
    {showSummary && <MonthlyRoiSummary report={r} />}
    <Card>
      <CardTitle hint="Nos indicadores por horário, o primeiro número é dentro do expediente humano e o segundo é fora.">O que aconteceu no mês</CardTitle>
      <p className="mb-4 text-sm text-neutral panel:text-white/55">Comparativo com {previousLabel}. Horários: dentro / fora do expediente humano.</p>
      <DataTable caption="Indicadores do mês e comparativo anterior" head={["Indicador", "Este mês", "Mês anterior"]} rows={monthlyRows(r).map((cells) => ({ id: cells[0], cells }))} />
      {!a.trackingComplete && <p className="mt-3 text-xs text-warn">* Qualificação, transbordos e perguntas sem resposta têm cobertura parcial: apenas eventos explícitos registrados após a implantação. Ausência de registro histórico não significa zero ocorrências.</p>}
      {!r.previousConfigured && <p className="mt-2 text-xs text-neutral panel:text-white/55">Mês anterior sem premissas: os totais operacionais são comparáveis; classificações de horário e valores financeiros estão pendentes.</p>}
      <p className="mt-2 text-xs text-neutral panel:text-white/55">Sem classificação de horário: {a.conversations.unclassified} conversas, {a.scheduled.unclassified} agendadas e {a.attended.unclassified} realizadas. Comparecimento pendente: {a.attendanceUnknown}. Agendamentos sem tipo: {a.untypedAppointments}.</p>
      {r.clinicorpError && <p className="mt-2 text-xs text-warn">{r.clinicorpError}</p>}
    </Card>
    <Card>
      <CardTitle>Destaques do mês</CardTitle>
      <div className="grid gap-4 md:grid-cols-2">
        <div><p className="mb-3 text-sm font-medium">Procedimentos</p>{a.procedures.length ? <div className="space-y-3">{a.procedures.map((p) => <div key={p.name} className="border-l-2 border-iris pl-3"><p className="text-sm font-medium">{p.name}</p><p className="mt-1 text-sm text-neutral panel:text-white/60">{p.qualified} qualificados · {p.attendedOutside} avaliações realizadas de contatos fora do expediente</p><p className="mt-1 text-sm font-medium tabular-nums">{money(p.revenueCents)} <span className="font-normal text-neutral panel:text-white/55">de receita estimada</span></p></div>)}</div> : <p className="text-sm text-neutral panel:text-white/55">Sem procedimento registrado no período.</p>}</div>
        <div><p className="mb-3 text-sm font-medium">Horários de pico</p>{a.peaks.length ? <div className="space-y-3">{a.peaks.map((p) => <div key={p.hour} className="flex items-center gap-3"><Badge tone="iris">{String(p.hour).padStart(2, "0")}h</Badge><span className="text-sm text-neutral panel:text-white/70">{p.messages} mensagens recebidas</span></div>)}</div> : <p className="text-sm text-neutral panel:text-white/55">Sem mensagens recebidas no período.</p>}<p className="mt-3 text-xs text-neutral panel:text-white/55">Horário local da clínica · {TIMEZONES.find((zone) => zone.value === c.timezone)?.label ?? c.timezone}</p></div>
      </div>
    </Card>
    <div className="grid gap-6 md:grid-cols-2">
      <Card><CardTitle>O que ajustamos no agente</CardTitle><p className="whitespace-pre-wrap text-sm leading-relaxed text-neutral panel:text-white/70">{r.adjustments || "Aguardando revisão da Mavellium."}</p></Card>
      <Card><CardTitle>Próximo mês</CardTitle><p className="whitespace-pre-wrap text-sm leading-relaxed text-neutral panel:text-white/70">{r.nextMonth || "Aguardando plano da Mavellium."}</p></Card>
    </div>
    <Card><CardTitle hint="Valores informados pela clínica e conferidos pela Mavellium.">Como estimamos o retorno</CardTitle>
      <p className="mb-4 text-sm leading-relaxed text-neutral panel:text-white/65">Receita = avaliações realizadas de contatos que chegaram fora do expediente × conversão × ticket de cada procedimento. Economia = horas assumidas × custo/hora. ROI = (receita + economia − investimento) ÷ investimento.</p>
      <p className="text-sm">Custo do atendente: {money(c.attendantMonthlyCents)} / mês · carga: {number(c.attendantMonthlyHours, " h")} · custo/hora: {c.attendantMonthlyCents !== null && c.attendantMonthlyHours ? money(Math.round(c.attendantMonthlyCents / c.attendantMonthlyHours)) : "Pendente"}.</p>
      <p className="mt-2 text-sm">Horas estimadas: {a.aiOnlyConversations} conversas respondidas pelo agente sem resposta humana no mês × {number(c.minutesPerConversation, " minutos")} ÷ 60. Essa estimativa não mede tempo de execução da IA.</p>
      <div className="my-5"><DataTable caption="Premissas por procedimento" head={["Procedimento", "Ticket médio", "Conversão"]} rows={c.procedures.map((p) => ({ id: p.name, cells: [p.name, money(p.ticketCents), number(p.conversionBps === null ? null : p.conversionBps / 100, "%")] }))} /></div>
      <details className="border-t border-ink/10 pt-4 panel:border-white/10"><summary className="cursor-pointer text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-iris">Expediente humano e critérios de contagem</summary>
        <div className="my-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">{c.humanHours ? c.humanHours.map((hours, i) => <div key={i}><p className="font-medium">{days[i]}</p><p className="mt-1 text-neutral panel:text-white/60">{hours.length ? hours.map((h) => `${time(h.start)}–${time(h.end)}`).join(", ") : "Fechado"}</p></div>) : "Horário humano pendente."}</div>
        <p className="mt-3 text-sm leading-relaxed text-neutral panel:text-white/60">Avaliações consideradas: {c.evaluationTypes.join(", ")}. Marcações antigas sem tipo: {c.countUntypedAsEvaluations ? "conferidas como avaliações" : "aguardam classificação"}.</p>
        <p className="mt-2 text-sm leading-relaxed text-neutral panel:text-white/60">As conversas são contadas pela primeira interação respondida no mês. Nas avaliações, o horário é classificado pela primeira mensagem do contato, antes da marcação. Agendadas entram pelo mês da marcação; realizadas, pelo mês da consulta. Cancelamentos, testes e marcações manuais ficam fora. A primeira resposta também considera respostas humanas. A qualificação depende do registro do agente.</p>
      </details>
    </Card>
  </div>;
}
