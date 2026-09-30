import type { ReactNode } from "react";
import { formatBRL } from "@/lib/format";
import type { MonthlyReport } from "@/modules/reports/monthly";
import { ATTENDED_LABEL, BUCKET_LABEL, SCHEDULED_LABEL, bucketReason, isScheduledCounted, type AppointmentEvidence, type Bucket, type MonthlyEvidence } from "@/modules/reports/monthly-evidence";
import { QUALITY_LABEL, type MetricQuality, type QualityKey, type QualityStatus } from "@/modules/reports/monthly-quality";
import { formatDuration, formatMinutes, hoursPremise } from "@/modules/reports/monthly-time";
import { doubtLabel, lossLabel } from "@/modules/lead-insights/categories";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { EvidenceDialog } from "./EvidenceDialog";

/**
 * Selo de qualidade e "ver registros" de cada número do ROI mensal. As tabelas
 * saem de `report.evidence`, congelado no snapshot junto com os números — o
 * que a pessoa abre é exatamente o que compôs o número publicado. Só
 * identificadores, datas e classificações: nenhum dado de contato.
 */

const TONE: Record<QualityStatus, "success" | "neutral" | "warn" | "danger"> = {
  verified: "success", estimated: "neutral", partial: "warn", pending: "neutral", inconsistent: "danger",
};

export function QualityBadge({ quality }: { quality?: MetricQuality }) {
  if (!quality) return null;
  return <Badge tone={TONE[quality.status]} title={quality.reasons.join(" ")}>{QUALITY_LABEL[quality.status]}</Badge>;
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("pt-BR")} ${n === 1 ? one : many}`;
const STATUS_LABEL: Record<string, string> = { scheduled: "Agendado", done: "Concluído", canceled: "Cancelado" };
const OUTCOME_LABEL = { scheduled: "Agendou", handoff: "Transbordou", lost: "Perdeu", open: "Em andamento" } as const;
const VERDICT_LABEL = { in: "Dentro", out: "Fora", unknown: "Área não configurada" } as const;

function Short({ id, href }: { id: string | null; href?: boolean }) {
  if (!id) return <>—</>;
  const text = `…${id.slice(-8)}`;
  return href
    ? <a href={`/conversas?id=${id}`} target="_blank" rel="noreferrer" title={id} className="rounded-sm font-mono text-xs text-iris underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-iris">{text}</a>
    : <span title={id} className="font-mono text-xs">{text}</span>;
}

/** Quantos registros por motivo, na ordem em que aparecem. */
function Composition({ items }: { items: string[] }) {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  if (!counts.size) return null;
  return <ul className="grid gap-1 text-sm sm:grid-cols-2">{[...counts].map(([label, n]) => <li key={label} className="flex justify-between gap-4 border-b border-white/5 py-1"><span>{label}</span><span className="tabular-nums font-medium">{n}</span></li>)}</ul>;
}

function Body({ quality, summary, composition, truncated, total, children }: {
  quality?: MetricQuality; summary: ReactNode; composition?: string[]; truncated?: number; total?: number; children?: ReactNode;
}) {
  return <div className="space-y-5 text-white/85">
    {quality && <div className="space-y-2">
      <p className="flex flex-wrap items-center gap-2 text-sm"><span className="text-white/55">Qualidade do dado:</span><QualityBadge quality={quality} /></p>
      <ul className="list-disc space-y-1 pl-5 text-sm text-white/70">{quality.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
    </div>}
    <p className="text-sm leading-relaxed">{summary}</p>
    {composition && <Composition items={composition} />}
    {truncated !== undefined && <p className="text-xs text-warn">Lista com os primeiros {total?.toLocaleString("pt-BR")} de {truncated.toLocaleString("pt-BR")} registros. O número do relatório considera todos.</p>}
    {children}
  </div>;
}

const empty = (text: string) => <p className="text-sm text-white/55">{text}</p>;

function hourCell(bucket: Bucket, arrivalAt: string | null) {
  const reason = bucketReason(bucket, arrivalAt);
  return reason ? `${BUCKET_LABEL[bucket]} (${reason})` : BUCKET_LABEL[bucket];
}

type Entry = { count?: number; title: string; body: ReactNode };

function entry(r: MonthlyReport, e: MonthlyEvidence, key: QualityKey): Entry | null {
  const q = r.quality?.[key], a = r.current, c = r.assumptions;
  const tz = c.timezone;
  const format = new Intl.DateTimeFormat("pt-BR", { timeZone: tz, day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
  const when = (iso: string | null) => iso ? format.format(new Date(iso)) : "—";
  const cut = (list: keyof MonthlyEvidence["truncated"], length: number) => ({ truncated: e.truncated[list], total: length });

  switch (key) {
    case "newContacts":
    case "conversations": {
      const rows = key === "newContacts" ? e.conversations.filter((x) => x.counted && x.newContact)
        : [...e.conversations].sort((x, y) => Number(y.counted) - Number(x.counted));
      const situation = (x: typeof rows[number]) => x.counted ? "Contou" : x.excluded === "human_only" ? "Fora: só a equipe respondeu" : "Fora: sem resposta no mês";
      return { count: rows.length, title: key === "newContacts" ? "Novos contatos atendidos" : "Conversas respondidas", body: <Body quality={q}
        summary={key === "newContacts"
          ? `${plural(rows.length, "conversa", "conversas")} com resposta do agente, de contatos criados no mês.`
          : `Conversas com mensagem do contato no mês. Contam as que tiveram resposta do agente, classificadas pela primeira chegada respondida.`}
        composition={key === "newContacts" ? rows.map((x) => `Horário: ${BUCKET_LABEL[x.bucket]}`) : rows.map((x) => x.counted ? `Contou · ${BUCKET_LABEL[x.bucket]}` : situation(x))}
        {...cut("conversations", e.conversations.length)}>
        {rows.length ? <DataTable caption="Conversas" head={["Conversa", "Chegada", "Horário", "Contato novo", "Sem resposta humana", "Situação"]} columnAlign={["left", "left", "left", "left", "left", "left"]} headerAlign="left"
          rows={rows.map((x) => ({ id: x.conversationId, cells: [<Short key="c" id={x.conversationId} href />, when(x.arrivalAt), hourCell(x.bucket, x.arrivalAt), x.newContact ? "Sim" : "Não", x.aiOnly ? "Sim" : "Não", situation(x)] }))} /> : empty("Nenhuma conversa no mês.")}
      </Body> };
    }
    case "firstResponse": {
      const rows = [...e.responses].sort((x, y) => y.seconds - x.seconds);
      const seconds = rows.map((x) => x.seconds).sort((x, y) => x - y);
      const median = seconds.length ? (seconds.length % 2 ? seconds[(seconds.length - 1) / 2] : (seconds[seconds.length / 2 - 1] + seconds[seconds.length / 2]) / 2) : null;
      const average = (list: number[]) => list.length ? list.reduce((s, v) => s + v, 0) / list.length : null;
      const agent = rows.filter((x) => x.by === "agent").map((x) => x.seconds), human = rows.filter((x) => x.by === "human").map((x) => x.seconds);
      return { count: rows.length, title: "Primeira resposta média", body: <Body quality={q}
        summary={rows.length ? `${plural(rows.length, "conversa", "conversas")}: média de ${formatDuration(average(seconds))}, mediana de ${formatDuration(median)}, maior de ${formatDuration(seconds.at(-1))}. Agente: ${agent.length} (média ${formatDuration(average(agent))}). Equipe: ${human.length} (média ${formatDuration(average(human))}). A lista começa pelas mais demoradas.` : "Nenhuma resposta no mês."}
        {...cut("responses", e.responses.length)}>
        {rows.length > 0 && <DataTable caption="Primeiras respostas" head={["Conversa", "Chegada", "Resposta", "Tempo", "Respondeu"]} headerAlign="left" columnAlign={["left", "left", "left", "left", "left"]}
          rows={rows.map((x) => ({ id: x.conversationId, cells: [<Short key="c" id={x.conversationId} href />, when(x.inboundAt), when(x.replyAt), `${formatDuration(x.seconds)} (${Math.round(x.seconds).toLocaleString("pt-BR")} s)`, x.by === "agent" ? "Agente" : "Equipe"] }))} />}
      </Body> };
    }
    case "qualified":
    case "handoffs":
    case "unanswered": {
      const kind = key === "handoffs" ? "handoff" : key;
      const rows = e.events.filter((x) => x.kind === kind).sort((x, y) => x.at.localeCompare(y.at));
      const seen = new Set<string>();
      const counted = rows.map((x) => kind !== "qualified" || (!seen.has(x.conversationId) && Boolean(seen.add(x.conversationId))));
      const title = key === "qualified" ? "Leads qualificados" : key === "handoffs" ? "Transbordos para humano" : "Perguntas sem resposta";
      return { count: rows.length, title, body: <Body quality={q}
        summary={`${plural(rows.length, "evento registrado", "eventos registrados")} pelo agente no mês${kind === "qualified" ? `; conta uma vez por conversa (${seen.size}).` : "."}`}
        {...cut("events", e.events.length)}>
        {rows.length ? <DataTable caption={title} head={["Evento", "Conversa", "Data", ...(kind === "qualified" ? ["Procedimento", "Situação"] : [])]} headerAlign="left" columnAlign={["left", "left", "left", "left", "left"]}
          rows={rows.map((x, i) => ({ id: `${x.eventId}-${i}`, cells: [<Short key="e" id={x.eventId} />, <Short key="c" id={x.conversationId} href />, when(x.at),
            ...(kind === "qualified" ? [x.procedure ?? "Não informado", counted[i] ? "Contou" : "Repetido na mesma conversa"] : [])] }))} /> : empty("Nenhum evento registrado no mês.")}
      </Body> };
    }
    case "scheduled":
    case "attended": {
      const scheduled = key === "scheduled";
      const rows = e.appointments.filter((x) => scheduled ? x.createdInMonth : x.startsInMonth)
        .sort((x, y) => Number(scheduled ? isScheduledCounted(y) : y.attended === "attended") - Number(scheduled ? isScheduledCounted(x) : x.attended === "attended") || x.startsAt.localeCompare(y.startsAt));
      const criterion = (x: AppointmentEvidence) => scheduled ? SCHEDULED_LABEL[x.scheduled] : ATTENDED_LABEL[x.attended];
      const statusType = (x: AppointmentEvidence) => !x.clinicorp.linked ? "Sem vínculo"
        : x.clinicorp.statusType ? r.clinicorpStatusTypes.find((s) => s.type === x.clinicorp.statusType)?.description ?? x.clinicorp.statusType : "Sem status lido";
      const title = scheduled ? "Avaliações agendadas" : "Avaliações realizadas";
      return { count: rows.length, title, body: <Body quality={q}
        summary={scheduled
          ? `${plural(rows.length, "agendamento feito pelo agente e criado", "agendamentos feitos pelo agente e criados")} no mês. Contam os de tipo avaliação${c.countUntypedAsEvaluations ? " e os sem tipo, conferidos" : ""}; o horário vem da primeira mensagem do contato antes da marcação.`
          : `${plural(rows.length, "consulta marcada pelo agente", "consultas marcadas pelo agente")} para este mês. Contam as de tipo avaliação com comparecimento confirmado no fechai ou pelo status do Clinicorp (${c.completedStatusTypes.join(", ") || "nenhum status definido"}).`}
        composition={rows.map(criterion)} {...cut("appointments", e.appointments.length)}>
        {rows.length ? <DataTable caption={title} headerAlign="left" columnAlign={Array(9).fill("left")}
          head={["Agendamento", "Conversa", "Criado em", "Consulta", "Tipo", "Procedimento", scheduled ? "Chegada do contato" : "Clinicorp", "Horário", "Critério"]}
          rows={rows.map((x) => ({ id: x.appointmentId, cells: [<Short key="a" id={x.appointmentId} />, <Short key="c" id={x.conversationId} href />, when(x.createdAt), `${when(x.startsAt)} · ${STATUS_LABEL[x.status] ?? x.status}`,
            x.serviceType ?? "Sem tipo", x.procedure ?? "Não informado", scheduled ? when(x.arrivalAt) : statusType(x), hourCell(x.bucket, x.arrivalAt), criterion(x)] }))} /> : empty("Nenhum agendamento do agente neste mês.")}
      </Body> };
    }
    case "gapAnswer": {
      const rows = [...e.gaps].sort((x, y) => y.seconds - x.seconds);
      return { count: rows.length, title: "Tempo médio para a equipe responder", body: <Body quality={q}
        summary={`${plural(rows.length, "pergunta aprovada", "perguntas aprovadas")} no mês, da primeira vez perguntada até a aprovação.`}>
        {rows.length ? <DataTable caption="Perguntas aprovadas" head={["Pergunta", "Primeira vez", "Aprovada em", "Tempo"]} headerAlign="left" columnAlign={["left", "left", "left", "left"]}
          rows={rows.map((x) => ({ id: x.gapId, cells: [<Short key="g" id={x.gapId} />, when(x.firstAskedAt), when(x.answeredAt), formatDuration(x.seconds)] }))} /> : empty("Nenhuma pergunta aprovada no mês.")}
      </Body> };
    }
    case "audios":
    case "textMessages": {
      const kind = key === "audios" ? "audio" : "text";
      const rows = e.messages.filter((x) => x.kind === kind);
      const out = e.messagesExcluded;
      const title = kind === "audio" ? "Áudios ouvidos pelo agente" : "Mensagens de texto respondidas pelo agente";
      return { count: rows.length, title, body: <Body quality={q}
        summary={`${plural(rows.length, kind === "audio" ? "áudio" : "mensagem", kind === "audio" ? "áudios" : "mensagens")} do contato cuja primeira resposta foi do agente${kind === "audio" ? `, somando ${formatMinutes(rows.reduce((s, x) => s + (x.seconds ?? 0), 0) / 60)} medidos` : ""}. Fora da conta no mês: ${out.humanFirst} respondidas primeiro pela equipe, ${out.unheardAudio} áudios sem transcrição e ${out.noReply} sem resposta.`}
        {...cut("messages", e.messages.length)}>
        {rows.length ? <DataTable caption={title} head={["Mensagem", "Conversa", "Recebida em", ...(kind === "audio" ? ["Duração"] : [])]} headerAlign="left" columnAlign={["left", "left", "left", "left"]}
          rows={rows.map((x, i) => ({ id: `${x.messageId}-${i}`, cells: [<Short key="m" id={x.messageId} />, <Short key="c" id={x.conversationId} href />, when(x.at),
            ...(kind === "audio" ? [x.seconds === null ? "Sem duração medida" : formatDuration(x.seconds)] : [])] }))} /> : empty("Nenhum registro no mês.")}
      </Body> };
    }
    case "peaks": {
      const top = new Set(a.peaks.map((p) => p.hour));
      const rows = e.hours.map((messages, hour) => ({ hour, messages })).filter((x) => x.messages > 0);
      return { count: rows.reduce((s, x) => s + x.messages, 0), title: "Horários de pico", body: <Body quality={q}
        summary={`Mensagens recebidas no mês por hora local (${tz}). Os picos são as três horas com mais mensagens.`}>
        {rows.length ? <DataTable caption="Mensagens por hora" head={["Hora", "Mensagens recebidas", "Pico"]}
          rows={rows.map((x) => ({ id: String(x.hour), cells: [`${String(x.hour).padStart(2, "0")}h`, x.messages.toLocaleString("pt-BR"), top.has(x.hour) ? "Sim" : ""] }))} /> : empty("Sem mensagens recebidas no mês.")}
      </Body> };
    }
    case "leads": {
      const rows = e.leads;
      if (!rows || !r.leadQuality) return null;
      return { count: rows.length, title: "Leads do mês", body: <Body quality={q}
        summary={`${plural(r.leadQuality.leads, "lead real criado", "leads reais criados")} no mês. Cidade, dúvida e motivo são o que o contato disse ao agente; dentro/fora do raio usa a área cadastrada.`}
        composition={rows.map((x) => OUTCOME_LABEL[x.outcome])} {...cut("leads", rows.length)}>
        <DataTable caption="Leads" head={["Lead", "Conversa", "Criado em", "Cidade", "Raio", "Resultado", "Motivo de perda", "Primeira dúvida"]} headerAlign="left" columnAlign={Array(8).fill("left")}
          rows={rows.map((x) => ({ id: x.leadId, cells: [<Short key="l" id={x.leadId} />, <Short key="c" id={x.conversationId} href />, when(x.createdAt), x.city ?? "Não informou",
            x.verdict ? VERDICT_LABEL[x.verdict] : "—", OUTCOME_LABEL[x.outcome], x.lossKey ? lossLabel(x.lossKey) : "—", x.doubtKey ? doubtLabel(x.doubtKey) : "—"] }))} />
      </Body> };
    }
    case "assumedHours":
      return { title: "Horas devolvidas à equipe", body: <Body quality={q}
        summary={`${hoursPremise(r)}. Os registros de mensagens e áudios estão em "Mensagens de texto respondidas pelo agente" e "Áudios ouvidos pelo agente".`} /> };
    case "savings":
      return { title: "Economia estimada", body: <Body quality={q}
        summary={`Horas devolvidas (${a.assumedHours === null ? "pendente" : formatDuration(a.assumedHours * 3600)}) × custo/hora do atendente (${c.attendantMonthlyCents !== null && c.attendantMonthlyHours ? formatBRL(Math.round(c.attendantMonthlyCents / c.attendantMonthlyHours)) : "pendente"}) = ${a.savingsCents === null ? "pendente" : formatBRL(a.savingsCents)}.`} /> };
    case "revenue":
      return { title: "Receita estimada", body: <Body quality={q}
        summary={'Avaliações realizadas de contatos que chegaram fora do expediente × conversão × ticket, por procedimento. Os agendamentos estão em "Avaliações realizadas".'}>
        {a.procedures.length ? <DataTable caption="Receita por procedimento" head={["Procedimento", "Realizadas fora", "Conversão", "Ticket", "Receita"]}
          rows={a.procedures.map((p) => {
            const premise = c.procedures.find((x) => x.name === p.name);
            return { id: p.name, cells: [p.name, String(p.attendedOutside), premise?.conversionBps == null ? "Pendente" : `${(premise.conversionBps / 100).toLocaleString("pt-BR")}%`,
              premise?.ticketCents == null ? "Pendente" : formatBRL(premise.ticketCents), p.revenueCents === null ? "Pendente" : formatBRL(p.revenueCents)] };
          })} /> : empty("Sem procedimento registrado no mês.")}
      </Body> };
    case "investment":
      return { title: "Investimento mensal", body: <Body quality={q} summary={`Mensalidade do Fechai: ${a.investmentCents === null ? "pendente" : formatBRL(a.investmentCents)}${r.investmentSource ? ` (${r.investmentSource})` : ""}.`} /> };
    case "roi":
      return { title: "ROI estimado", body: <Body quality={q}
        summary={`(receita ${a.revenueCents === null ? "pendente" : formatBRL(a.revenueCents)} + economia ${a.savingsCents === null ? "pendente" : formatBRL(a.savingsCents)} − mensalidade ${a.investmentCents === null ? "pendente" : formatBRL(a.investmentCents)}) ÷ mensalidade = ${a.roiPercent === null ? "pendente" : `${a.roiPercent.toLocaleString("pt-BR")}%`}.`} /> };
  }
}

/** Botão "ver registros" (ou "ver cálculo") de um indicador. Nada em relatório fechado antes do detalhamento. */
export function MetricEvidence({ report: r, metric }: { report: MonthlyReport; metric: QualityKey }) {
  if (!r.evidence) return null;
  const found = entry(r, r.evidence, metric);
  if (!found) return null;
  const label = found.count === undefined ? "Ver cálculo" : `Ver registros (${found.count.toLocaleString("pt-BR")})`;
  const description = found.count === undefined ? `Como o número de ${r.label} é calculado.` : `Registros de ${r.label} que compõem o número.`;
  return <EvidenceDialog label={label} title={found.title} description={description}>{found.body}</EvidenceDialog>;
}
