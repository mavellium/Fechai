import { formatBRL } from "@/lib/format";
import { formatGapTime as gapTime } from "@/modules/knowledge-gaps/text";
import type { MonthlyMetrics, MonthlyReport, SplitCount } from "@/modules/reports/monthly";
import { formatDuration, formatMinutes, hoursPremise, timeHeadline, type DurationStats } from "@/modules/reports/monthly-time";
import { Card, CardTitle } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { DataTable } from "@/components/ui/data-table";
import { TIMEZONES } from "@/modules/scheduling/time";
import { SUGGESTION_DISCLAIMER, leadQualityHeadline, type LeadQuality, type RankItem } from "@/modules/lead-insights/summary";
import { QUALITY_LEGEND, type QualityKey } from "@/modules/reports/monthly-quality";
import { unverifiedMetrics } from "@/modules/reports/monthly-limitations";
import { MetricEvidence, QualityBadge } from "./MonthlyEvidence";

export const total = (s: SplitCount) => s.inside + s.outside + s.unclassified;
const number = (v: number | null, suffix = "", empty = "Pendente") => v === null ? empty : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}${suffix}`;
const money = (v: number | null, empty = "Pendente") => v === null ? empty : formatBRL(v);
/** Fechado com cobertura parcial, o número sem evidência é entregue como "não verificado". */
export const unknownLabel = (r: Pick<MonthlyReport, "status">) => r.status === "ready" ? "Não verificado" : "Pendente";
// Relatórios fechados antes da medição não têm `time`: "não medido", nunca zero.
const audioCell = (m: MonthlyMetrics) => !m.time ? "Não medido"
  : m.time.audioMinutes ? `${m.time.audios} · ${formatMinutes(m.time.audioMinutes)}` : number(m.time.audios);
const usesMeasuredTime = (r: MonthlyReport) => r.assumptions.secondsPerMessage != null && Boolean(r.current.time) && r.metricOverrides?.current.assumedHours === undefined;
export function monthlyRows(r: MonthlyReport): { key: QualityKey; cells: string[] }[] {
  const a = r.current, b = r.previous, empty = unknownLabel(r);
  const rows: [QualityKey, string, string, string][] = [
    ["newContacts", "Novos contatos atendidos", number(a.newContacts), number(b.newContacts)],
    ["conversations", "Conversas · dentro / fora", r.assumptions.humanHours ? `${a.conversations.inside} / ${a.conversations.outside}` : `${empty} (${total(a.conversations)} no total)`, r.previousAssumptions.humanHours ? `${b.conversations.inside} / ${b.conversations.outside}` : `${empty} (${total(b.conversations)} no total)`],
    ["firstResponse", "Primeira resposta média", number(a.firstResponseSeconds, " s", empty), number(b.firstResponseSeconds, " s", empty)],
    ["qualified", "Leads qualificados", `${a.qualified}${a.trackingComplete ? "" : " registrados*"}`, `${b.qualified}${b.trackingComplete ? "" : " registrados*"}`],
    ["scheduled", "Avaliações agendadas · dentro / fora", r.assumptions.humanHours ? `${a.scheduled.inside} / ${a.scheduled.outside}` : empty, r.previousAssumptions.humanHours ? `${b.scheduled.inside} / ${b.scheduled.outside}` : empty],
    ["attended", "Avaliações realizadas · dentro / fora", r.assumptions.humanHours ? `${a.attended.inside} / ${a.attended.outside}` : empty, r.previousAssumptions.humanHours ? `${b.attended.inside} / ${b.attended.outside}` : empty],
    ["handoffs", "Transbordos para humano", `${a.handoffs}${a.trackingComplete ? "" : " registrados*"}`, `${b.handoffs}${b.trackingComplete ? "" : " registrados*"}`],
    ["unanswered", "Perguntas sem resposta", `${a.unanswered}${a.trackingComplete ? "" : " registradas*"}`, `${b.unanswered}${b.trackingComplete ? "" : " registradas*"}`],
    ["gapAnswer", "Tempo médio para a equipe responder", gapTime(a), gapTime(b)],
    ["audios", "Áudios ouvidos pelo agente", audioCell(a), audioCell(b)],
    ["textMessages", "Mensagens de texto respondidas pelo agente", a.time ? number(a.time.textMessages) : "Não medido", b.time ? number(b.time.textMessages) : "Não medido"],
    ["assumedHours", "Horas devolvidas à equipe (estimadas)", number(a.assumedHours, " h", empty), number(b.assumedHours, " h", empty)],
    ["roi", "ROI estimado", number(a.roiPercent, "%", empty), number(b.roiPercent, "%", empty)],
  ];
  return rows.map(([key, ...cells]) => ({ key, cells }));
}
/** Selo e "ver registros" abaixo de um número em destaque. */
function StatSource({ report: r, metric }: { report: MonthlyReport; metric: QualityKey }) {
  if (!r.quality?.[metric]) return null;
  return <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1"><QualityBadge quality={r.quality[metric]} /><MetricEvidence report={r} metric={metric} /></div>;
}
/**
 * Resumo executivo (a "página 1"): o decisor vê primeiro o valor entregue —
 * quatro números, o resumo do período e as próximas ações. O detalhe técnico
 * vem depois, em "Análise detalhada". Mesma ordem do PDF.
 */
export function MonthlyRoiSummary({ report: r, showMissing = true }: { report: MonthlyReport; showMissing?: boolean }) {
  const a = r.current, empty = unknownLabel(r), t = a.time;
  const actions = r.nextActions ?? [];
  return <section className="space-y-5" aria-label="Resumo executivo">
    <div className="rounded-surface bg-ink p-6 text-white panel:border panel:border-white/10 panel:bg-white/5">
      <p className="font-mono text-micro uppercase tracking-[0.2em] text-white/60">Fechai · relatório mensal</p>
      <h2 className="mt-2 font-display text-2xl font-semibold">Resultados de {r.label.split(" de ")[0]}</h2>
      <div className="mt-2 flex flex-wrap items-center gap-2"><span className="text-sm text-white/70">{r.tenantName} · {r.label}</span><Badge tone="neutral">Valores estimados</Badge>{r.partial && <Badge tone="warn">Mês em andamento</Badge>}</div>
    </div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Stat label="Contatos atendidos" value={number(total(a.conversations))} hint="conversas respondidas pelo agente" footer={<MetricEvidence report={r} metric="conversations" />} />
      <Stat label="Conversas só com IA" value={number(a.aiOnlyConversations)} hint="sem precisar da equipe" />
      <Stat label="Mensagens respondidas" value={t ? number(t.textMessages + t.audios) : "Não medido"} hint="textos e áudios que o agente respondeu" footer={<MetricEvidence report={r} metric="textMessages" />} />
      <Stat label="ROI estimado" value={number(a.roiPercent, "%", empty)} hint={a.roiPercent === null ? "premissas incompletas" : "retorno sobre o investimento"} footer={<StatSource report={r} metric="roi" />} />
    </div>
    <div className="grid gap-4 sm:grid-cols-3">
      <Stat compact label="Receita estimada" value={money(a.revenueCents, empty)} hint="contatos que chegaram fora do expediente" footer={<StatSource report={r} metric="revenue" />} />
      <Stat compact label="Economia estimada" value={money(a.savingsCents, empty)} hint="tempo devolvido à equipe" footer={<StatSource report={r} metric="savings" />} />
      <Stat compact label="Investimento mensal" value={money(a.investmentCents, empty)} hint="mensalidade do Fechai" footer={<StatSource report={r} metric="investment" />} />
    </div>
    <p className="text-sm leading-relaxed text-neutral panel:text-white/60">A receita considera as avaliações realizadas de contatos que chegaram fora do horário humano. {usesMeasuredTime(r) ? "A economia estima o tempo que a recepção gastaria ouvindo os áudios e respondendo as mensagens que o agente atendeu." : "A economia estima o tempo de atendimento assumido pelo agente."}</p>
    {a.investmentCents === 0 && <Alert>Mensalidade zero: o ROI percentual não se aplica.</Alert>}
    <div className="grid gap-4 lg:grid-cols-2">
      <Card><CardTitle>Resumo do período</CardTitle>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-neutral panel:text-white/75">{r.highlights || "Aguardando a síntese da Mavellium."}</p>
      </Card>
      <Card><CardTitle hint="Prioridades aprovadas para o próximo mês.">Próximas ações</CardTitle>
        {actions.length ? <ol className="space-y-3">{actions.map((item, i) => <li key={i} className="flex gap-3">
          <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-iris/15 text-xs font-semibold text-iris panel:text-white">{i + 1}</span>
          <div><p className="text-sm font-medium">{item.action}</p><p className="mt-0.5 text-xs text-neutral panel:text-white/55">Responsável: {item.owner} · Indicador: {item.indicator}</p></div>
        </li>)}</ol> : <p className="whitespace-pre-wrap text-sm leading-relaxed text-neutral panel:text-white/70">{r.nextMonth || "Aguardando o plano da Mavellium."}</p>}
      </Card>
    </div>
    {/* Relatório com a lista calculada mostra as limitações; os fechados antes dela, o "missing" de sempre. */}
    {showMissing && (r.limitations
      ? r.limitations.length > 0 && <MonthlyLimitations report={r} />
      : a.missing.length > 0 && <Alert tone="warn" title="Dados pendentes para calcular o retorno"><ul className="mt-1 list-disc space-y-1 pl-4">{a.missing.map((m) => <li key={m}>{m}</li>)}</ul></Alert>)}
  </section>;
}

/**
 * O que ficou sem evidência neste fechamento: a lista calculada, a explicação
 * da revisão e os indicadores entregues como "não verificado".
 */
export function MonthlyLimitations({ report: r }: { report: MonthlyReport }) {
  const list = r.limitations ?? [];
  if (!list.length) return null;
  const unverified = unverifiedMetrics(r);
  const closed = r.status === "ready";
  return <Alert tone="warn" title={closed ? "Fechado com cobertura parcial" : "Cobertura parcial"}>
    <p>{closed ? "Os indicadores sem evidência aparecem como não verificados e ficam fora da conta do retorno; nada foi estimado no lugar deles." : "Sem estes dados, os indicadores afetados ficam como pendentes e fora da conta do retorno."}</p>
    {r.limitationsNote && <p className="mt-2 whitespace-pre-wrap">{r.limitationsNote}</p>}
    {unverified.length > 0 && <p className="mt-2"><span className="font-medium">{closed ? "Não verificados" : "Pendentes"}:</span> {unverified.join(", ")}.</p>}
    <ul className="mt-2 list-disc space-y-1 pl-4">{list.map((l) => <li key={l.key}>{l.text} <span className="opacity-75">Afeta: {l.affects.join(", ")}.</span></li>)}</ul>
  </Alert>;
}

const OUTCOMES: [keyof NonNullable<MonthlyMetrics["time"]>["sessions"], string][] = [
  ["all", "Todos"], ["scheduled", "Agendou"], ["handoff", "Transbordou para a equipe"], ["lost", "Perdido"], ["other", "Sem desfecho registrado"],
];
const durationRow = (label: string, s: DurationStats) => [label, number(s.count), formatMinutes(s.averageMinutes), formatMinutes(s.medianMinutes), number(s.averageMessages)];

/** O trabalho da recepção que o agente assumiu. Ausente em relatórios fechados antes da medição. */
function TimeReturnedCard({ report: r }: { report: MonthlyReport }) {
  const a = r.current, t = a.time;
  if (!t) return null;
  const empty = t.sessions.all.count === 0 && t.textMessages + t.audios === 0;
  return <Card>
    <CardTitle hint="Estimativa. As premissas estão no fim deste bloco.">Tempo que o Fechai devolveu para sua equipe</CardTitle>
    {empty ? <p className="text-sm text-neutral panel:text-white/55">Sem atendimentos do agente neste mês. O bloco é preenchido com as mensagens e os áudios que ele responder.</p> : <>
      <p className="max-w-prose text-base leading-relaxed">{timeHeadline(t, total(a.conversations), a.assumedHours, a.savingsCents)}</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat compact label="Áudio ouvido" value={t.audioMinutes ? formatMinutes(t.audioMinutes) : String(t.audios)} hint={t.audioMinutes ? `${t.audios} áudios respondidos` : "áudios respondidos"} footer={<StatSource report={r} metric="audios" />} />
        <Stat compact label="Áudios longos" value={String(t.longAudios)} hint={t.longestAudioSeconds === null ? "acima de 2 min" : `acima de 2 min · maior: ${formatDuration(t.longestAudioSeconds)}`} />
        <Stat compact label="Mensagens de texto" value={String(t.textMessages)} hint="respondidas pelo agente" footer={<StatSource report={r} metric="textMessages" />} />
        <Stat compact label="Tempo devolvido" value={a.assumedHours === null ? unknownLabel(r) : formatDuration(a.assumedHours * 3600)} hint={a.savingsCents === null ? "aguardando custo do atendente" : `${formatBRL(a.savingsCents)} estimados`} footer={<StatSource report={r} metric="assumedHours" />} />
      </div>
      {r.featuredCase && <figure className="mt-6 border-l-2 border-iris pl-4">
        <figcaption className="font-mono text-micro uppercase tracking-[0.2em] text-neutral panel:text-white/55">Caso do mês</figcaption>
        <blockquote className="mt-2 max-w-prose text-sm leading-relaxed">{r.featuredCase}</blockquote>
      </figure>}
      <h3 className="mt-8 mb-3 text-sm font-medium">Duração dos atendimentos</h3>
      <DataTable caption="Duração dos atendimentos por resultado" head={["Resultado", "Atendimentos", "Duração média", "Mediana", "Mensagens (média)"]}
        rows={OUTCOMES.map(([key, label]) => ({ id: key, cells: durationRow(label, t.sessions[key]) }))} />
      <p className="mt-3 text-sm">{t.toSchedule.count
        ? `Até o agendamento: média de ${formatMinutes(t.toSchedule.averageMinutes)}, mediana de ${formatMinutes(t.toSchedule.medianMinutes)} e ${number(t.toSchedule.averageMessages)} mensagens trocadas desde a primeira mensagem do contato.`
        : "Nenhum agendamento feito pelo agente em atendimentos iniciados neste mês."}</p>
    </>}
    <p className="mt-4 text-xs leading-relaxed text-neutral panel:text-white/55">
      Contam as mensagens e os áudios do contato que o agente respondeu; áudio que ele não ouviu (sem transcrição) e o que a equipe respondeu ficam fora.
      {t.unmeasuredAudios > 0 && ` ${t.unmeasuredAudios} áudio(s) sem duração medida — recebidos antes de o Fechai medir a duração ou em formato que não conseguimos ler — entram só com o tempo de resposta.`}
      {" "}Um atendimento vai da primeira mensagem do contato até a última antes de 24h de silêncio. Agendou: agendamento feito pelo agente e não cancelado; perdido: contato marcado como perdido hoje, no último atendimento.
    </p>
  </Card>;
}

const topLine = (items: RankItem[]) => items.slice(0, 4).map((i) => `${i.label} (${i.count})`).join(" · ");

/**
 * Qualidade dos leads do mês, para o decisor e a agência de tráfego. Ausente em
 * relatórios fechados antes do bloco. Só agregados: nenhum dado de paciente.
 */
function LeadQualityCard({ quality: q, report: r }: { quality: LeadQuality; report: MonthlyReport }) {
  return <Card>
    <CardTitle hint="O que o agente registrou do que os contatos disseram. Sugestões são hipóteses, não promessa.">Qualidade dos leads e melhorias para o tráfego</CardTitle>
    {q.leads === 0 ? <p className="text-sm text-neutral panel:text-white/55">Sem leads novos neste mês.</p> : <>
      <p className="max-w-prose text-base leading-relaxed">{leadQualityHeadline(q)}</p>
      <StatSource report={r} metric="leads" />
      <dl className="mt-4 grid gap-4 text-sm md:grid-cols-3">
        <div><dt className="font-medium">Cidades mais citadas</dt><dd className="mt-1 text-neutral panel:text-white/60">{q.cities.length ? q.cities.slice(0, 4).map((c) => `${c.city} (${c.count}${c.verdict === "out" ? ", fora do raio" : ""})`).join(" · ") : "Nenhuma cidade informada."}</dd></div>
        <div><dt className="font-medium">Primeiras dúvidas</dt><dd className="mt-1 text-neutral panel:text-white/60">{q.doubts.length ? topLine(q.doubts) : "Nenhuma registrada."}</dd></div>
        <div><dt className="font-medium">Motivos de perda</dt><dd className="mt-1 text-neutral panel:text-white/60">{q.losses.length ? topLine(q.losses) : "Nenhum lead perdido."}</dd></div>
      </dl>
      {q.suggestions.length > 0 ? <>
        <p className="mt-6 text-sm font-medium">Melhorias sugeridas</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed">{q.suggestions.map((s) => <li key={s}>{s}</li>)}</ul>
      </> : q.lowSample && q.withCity > 0 ? <p className="mt-4 text-sm text-neutral panel:text-white/55">Poucos leads informaram a cidade ({q.withCity}); as sugestões só aparecem com pelo menos 10.</p> : null}
      <p className="mt-4 text-xs leading-relaxed text-neutral panel:text-white/55">{SUGGESTION_DISCLAIMER}</p>
    </>}
  </Card>;
}

export function MonthlyView({ report: r, showSummary = true }: { report: MonthlyReport; showSummary?: boolean }) {
  const a = r.current, c = r.assumptions;
  const days = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const time = (v: number) => `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
  const previousLabel = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${r.previousMonth}-01T12:00:00Z`));
  return <div className="space-y-6 text-ink panel:text-white/85">
    {showSummary && <MonthlyRoiSummary report={r} />}
    <div className="border-t border-ink/10 pt-6 panel:border-white/10"><h2 className="font-display text-lg font-semibold text-ink panel:text-white">Análise detalhada</h2><p className="mt-1 text-sm text-neutral panel:text-white/60">Evidências e metodologia: de onde vem cada número do resumo.</p></div>
    <TimeReturnedCard report={r} />
    <Card>
      <CardTitle hint="Nos indicadores por horário, o primeiro número é dentro do expediente humano e o segundo é fora.">O que aconteceu no mês</CardTitle>
      <p className="mb-4 text-sm text-neutral panel:text-white/55">Comparativo com {previousLabel}. Horários: dentro / fora do expediente humano.</p>
      {(Object.keys(r.metricOverrides?.current ?? {}).length > 0 || Object.keys(r.metricOverrides?.previous ?? {}).length > 0) && <Alert title="Dados conferidos manualmente">Este relatório inclui indicadores ajustados pela Mavellium. Os valores financeiros continuam estimados pela fórmula e pelas premissas abaixo.</Alert>}
      {r.quality
        ? <DataTable caption="Indicadores do mês e comparativo anterior" head={["Indicador", "Este mês", "Mês anterior", "Qualidade", "Origem"]}
            rows={monthlyRows(r).map(({ key, cells }) => ({ id: key, cells: [...cells, <QualityBadge key="q" quality={r.quality?.[key]} />, <MetricEvidence key="e" report={r} metric={key} />] }))} />
        : <DataTable caption="Indicadores do mês e comparativo anterior" head={["Indicador", "Este mês", "Mês anterior"]} rows={monthlyRows(r).map(({ key, cells }) => ({ id: key, cells }))} />}
      {r.quality && <p className="mt-3 text-xs leading-relaxed text-neutral panel:text-white/55">{QUALITY_LEGEND} Em &quot;Ver registros&quot;, a lista do que compõe cada número de {r.label}.</p>}
      {!a.trackingComplete && <p className="mt-3 text-xs text-warn">* Qualificação, transbordos e perguntas sem resposta têm cobertura parcial: apenas eventos explícitos registrados após a implantação. Ausência de registro histórico não significa zero ocorrências.</p>}
      {!r.previousConfigured && <p className="mt-2 text-xs text-neutral panel:text-white/55">Mês anterior sem premissas: os totais operacionais são comparáveis; classificações de horário e valores financeiros estão pendentes.</p>}
      <p className="mt-2 text-xs text-neutral panel:text-white/55">Sem classificação de horário: {a.conversations.unclassified} conversas, {a.scheduled.unclassified} agendadas e {a.attended.unclassified} realizadas. Comparecimento pendente: {a.attendanceUnknown}. Agendamentos sem tipo: {a.untypedAppointments}.</p>
      {r.clinicorpError && <p className="mt-2 text-xs text-warn">{r.clinicorpError}</p>}
    </Card>
    <Card>
      <CardTitle>Procedimentos e horários de pico</CardTitle>
      <div className="grid gap-4 md:grid-cols-2">
        <div><p className="mb-3 text-sm font-medium">Procedimentos</p>{a.procedures.length ? <div className="space-y-3">{a.procedures.map((p) => <div key={p.name} className="border-l-2 border-iris pl-3"><p className="text-sm font-medium">{p.name}</p><p className="mt-1 text-sm text-neutral panel:text-white/60">{p.qualified} qualificados · {p.attendedOutside} avaliações realizadas de contatos fora do expediente</p><p className="mt-1 text-sm font-medium tabular-nums">{money(p.revenueCents)} <span className="font-normal text-neutral panel:text-white/55">de receita estimada</span></p></div>)}</div> : <p className="text-sm text-neutral panel:text-white/55">Sem procedimento registrado no período.</p>}</div>
        <div><div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1"><p className="text-sm font-medium">Horários de pico</p><QualityBadge quality={r.quality?.peaks} /><MetricEvidence report={r} metric="peaks" /></div>{a.peaks.length ? <div className="space-y-3">{a.peaks.map((p) => <div key={p.hour} className="flex items-center gap-3"><Badge tone="iris">{String(p.hour).padStart(2, "0")}h</Badge><span className="text-sm text-neutral panel:text-white/70">{p.messages} mensagens recebidas</span></div>)}</div> : <p className="text-sm text-neutral panel:text-white/55">Sem mensagens recebidas no período.</p>}<p className="mt-3 text-xs text-neutral panel:text-white/55">Horário local da clínica · {TIMEZONES.find((zone) => zone.value === c.timezone)?.label ?? c.timezone}</p></div>
      </div>
    </Card>
    {r.leadQuality && <LeadQualityCard quality={r.leadQuality} report={r} />}
    <Card><CardTitle>O que ajustamos no agente</CardTitle><p className="whitespace-pre-wrap text-sm leading-relaxed text-neutral panel:text-white/70">{r.adjustments || "Aguardando revisão da Mavellium."}</p></Card>
    <Card><CardTitle hint="Valores informados pela clínica e conferidos pela Mavellium.">Como estimamos o retorno</CardTitle>
      <p className="mb-4 text-sm leading-relaxed text-neutral panel:text-white/65">Receita = avaliações realizadas de contatos que chegaram fora do expediente × conversão × ticket de cada procedimento. Economia = horas assumidas × custo/hora. ROI = (receita + economia − investimento) ÷ investimento.</p>
      <p className="mb-3 text-sm text-neutral panel:text-white/65">Agentes considerados: {r.agentNames?.length ? r.agentNames.join(", ") : "todos os agentes da conta"}. Mensalidade: {money(c.investmentCents)}{r.investmentSource ? ` · ${r.investmentSource}, a conferir nesta competência` : ""}.</p>
      <p className="text-sm">Custo do atendente: {money(c.attendantMonthlyCents)} / mês · carga: {number(c.attendantMonthlyHours, " h")} · custo/hora: {c.attendantMonthlyCents !== null && c.attendantMonthlyHours ? money(Math.round(c.attendantMonthlyCents / c.attendantMonthlyHours)) : "Pendente"}.</p>
      <p className="mt-2 text-sm">Horas devolvidas à equipe: {hoursPremise(r)}{usesMeasuredTime(r) || r.metricOverrides?.current.assumedHours !== undefined ? "" : " (estimativa por conversa, usada enquanto o tempo por mensagem não é informado)"}. Essa estimativa não mede tempo de execução da IA.</p>
      <div className="my-5"><DataTable caption="Premissas por procedimento" head={["Procedimento", "Ticket médio", "Conversão"]} rows={c.procedures.map((p) => ({ id: p.name, cells: [p.name, money(p.ticketCents), number(p.conversionBps === null ? null : p.conversionBps / 100, "%")] }))} /></div>
      <details className="border-t border-ink/10 pt-4 panel:border-white/10"><summary className="cursor-pointer text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-iris">Expediente humano e critérios de contagem</summary>
        <div className="my-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">{c.humanHours ? c.humanHours.map((hours, i) => <div key={i}><p className="font-medium">{days[i]}</p><p className="mt-1 text-neutral panel:text-white/60">{hours.length ? hours.map((h) => `${time(h.start)}–${time(h.end)}`).join(", ") : "Fechado"}</p></div>) : "Horário humano pendente."}</div>
        <p className="mt-3 text-sm leading-relaxed text-neutral panel:text-white/60">Avaliações consideradas: {c.evaluationTypes.join(", ")}. Marcações antigas sem tipo: {c.countUntypedAsEvaluations ? "conferidas como avaliações" : "aguardam classificação"}.</p>
        <p className="mt-2 text-sm leading-relaxed text-neutral panel:text-white/60">As conversas são contadas pela primeira interação respondida no mês. Nas avaliações, o horário é classificado pela primeira mensagem do contato, antes da marcação. Agendadas entram pelo mês da marcação; realizadas, pelo mês da consulta. Cancelamentos, testes e marcações manuais ficam fora. A primeira resposta também considera respostas humanas. A qualificação depende do registro do agente.</p>
      </details>
    </Card>
  </div>;
}
