import type { MonthlyReport } from "./monthly";
import type { Metric } from "./monthly-data";
import { BUCKET_LABEL, type CohortStatus, type ContactEvidence, type CohortEvidence } from "./monthly-evidence";
import { formatCount, formatPercent, formatSpan } from "./monthly-format";
import { lossLabel } from "@/modules/lead-insights/categories";
import { CONTACT_CONTEXT_LABEL } from "./contact-context";

type Row = { id: string; cells: string[] };
export type V2EvidenceEntry = {
  key: string; label: string; value?: string; metric?: Metric;
  description: string; head: string[]; rows: Row[]; truncated?: number;
};
const COHORT_LABEL: Record<CohortStatus, string> = {
  attended: "Compareceu", no_show: "Falta marcada", upcoming: "Aguardando consulta", unverified: "Comparecimento não verificado",
};

/** Só projeta as listas da mesma passada do motor; nunca consulta nem recalcula indicadores. */
export function monthlyV2Evidence(r: MonthlyReport): V2EvidenceEntry[] {
  const d = r.data, e = r.evidence;
  if (!d || !e) return [];
  const entries: V2EvidenceEntry[] = [];
  const dateFormat = new Intl.DateTimeFormat("pt-BR", {
    timeZone: d.meta.timezone, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
  const when = (iso: string) => dateFormat.format(new Date(iso));
  const add = (key: string, label: string, metric: Metric, description: string, head: string[], rows: Row[],
    list: keyof typeof e.truncated, format: (n: number | null) => string = formatCount) => {
    entries.push({ key, label, metric, value: format(metric.value), description, head, rows, truncated: e.truncated[list] });
  };
  if (e.contacts) {
    const head = ["Conversa (ID)", "Chegada", "Expediente", "Recepção", "1ª resposta do agente", "Espera da recepção", "Agendou", "Motivo de não agendar"];
    const rows = e.contacts.map((c) => ({ id: c.conversationId, cells: [c.conversationId, when(c.arrivalAt), BUCKET_LABEL[c.bucket],
      c.transferred ? "Passada para a recepção" : "Só agente", formatSpan(c.agentSeconds), formatSpan(c.receptionSeconds),
      c.scheduled ? "Sim" : "Não", c.reasonKey ? lossLabel(c.reasonKey) : "—"] }));
    const contacts = (key: string, label: string, metric: Metric, description: string,
      filter: (c: ContactEvidence) => boolean, format?: (n: number | null) => string) =>
      add(key, label, metric, description, head, rows.filter((_, i) => filter(e.contacts![i])), "contacts", format);
    contacts("contacts", "Contatos atendidos", d.service.contacts.total,
      "Contatos que escreveram no mês e receberam resposta da IA ou da equipe. O expediente vem da primeira mensagem do contato no mês.", () => true);
    contacts("aiOnly", "Só pelo agente", d.service.aiOnly, "Contatos atendidos sem mensagem da equipe nem evento de transbordo no mês.", (c) => !c.transferred);
    contacts("transferred", "Passadas para a recepção", d.service.transferred,
      "Contatos atendidos com mensagem da equipe ou evento de transbordo no mês. Cada contato aparece uma vez.", (c) => c.transferred);
    contacts("agentResponse", "1ª resposta do agente (mediana)", d.service.agentFirstResponseSeconds,
      "Da primeira mensagem do contato no mês à primeira resposta, somente quando ela foi do agente. Resposta humana primeiro fica fora.", (c) => c.agentSeconds !== null, formatSpan);
    contacts("receptionAnswered", "Respondidas pela recepção", d.service.reception.answered,
      "Contatos passados para a recepção com resposta humana no mês.", (c) => c.transferred && c.receptionSeconds !== null);
    contacts("receptionResponse", "1ª resposta da recepção (mediana)", d.service.reception.firstResponseSeconds,
      "Do transbordo à primeira resposta humana; sem evento, da última mensagem do contato antes dessa resposta. Tempo corrido, limitado ao mês.",
      (c) => c.transferred && c.receptionSeconds !== null, formatSpan);
    contacts("receptionWait", "Espera acima de 1 hora", d.service.reception.waitedOverHour,
      "Respostas da recepção com espera maior que uma hora, segundo a regra do motor v2.", (c) => c.transferred && c.receptionSeconds !== null && c.receptionSeconds > 3600);
    contacts("receptionUnanswered", "Recepção sem resposta", d.service.reception.unanswered,
      "Contatos passados para a recepção sem resposta humana até o fim do mês.", (c) => c.transferred && c.receptionSeconds === null);
    // O motor guarda um motivo por contato; não reutilizar a população de leads criados do relatório antigo.
    entries.push({ key: "notScheduled", label: "Base dos motivos de não agendar",
      description: "Contatos atendidos no mês sem avaliação na coorte. Sem motivo registrado, o motor agrupa em Outros.",
      head, rows: rows.filter((_, i) => !e.contacts![i].scheduled), truncated: e.truncated.contacts });
  }
  if (d.service.contexts && e.contexts) {
    const head = ["Conversa (ID)", "Contexto", "Início no período", "Mensagem inicial (ID)", "Primeiro autor no histórico", "Atendido", "Agendou", "Avaliações (IDs)"];
    for (const group of d.service.contexts.groups.filter((g) => g.contacts > 0)) {
      add(`context_${group.key}`, group.label, { value: group.contacts, status: group.key === "unknown" ? "partial" : "measured", source: "messages+contexts" },
        "Uma linha por contato com atividade no período, inclusive abordagens sem resposta. Origem de aquisição não registrada. A taxa usa só contatos deste grupo, não o total atendido.", head,
        e.contexts.filter((row) => row.context === group.key).map((row) => ({ id: row.conversationId, cells: [row.conversationId,
          CONTACT_CONTEXT_LABEL[row.context], when(row.firstAt), row.firstMessageId ?? "—",
          ({ contact: "Contato", human: "Equipe", agent: "Agente", unknown: "Não identificado" })[row.lifetimeInitiator],
          row.attended ? "Sim" : "Não", row.booked ? "Sim" : "Não", row.appointmentIds.join(", ") || "—"] })), "contexts");
    }
  }
  if (e.cohort) {
    const head = ["Agendamento (ID)", "Conversa (ID)", "Marcado em", "Consulta", "Expediente", "Procedimento", "Situação", "Coorte"];
    const rows = e.cohort.map((a) => ({ id: a.appointmentId, cells: [a.appointmentId, a.conversationId ?? "—", when(a.createdAt), when(a.startsAt),
      BUCKET_LABEL[a.bucket], a.procedure ?? "Não informado", COHORT_LABEL[a.status], a.earlier ? "Mês anterior" : "Criada no mês"] }));
    const cohort = (key: string, label: string, metric: Metric, description: string,
      filter: (a: CohortEvidence) => boolean, format?: (n: number | null) => string) =>
      add(key, label, metric, description, head, rows.filter((_, i) => filter(e.cohort![i])), "cohort", format);
    cohort("scheduled", "Avaliações agendadas", d.schedule.cohort.total.total,
      "Avaliações do agente criadas no mês, sem canceladas. A classificação do expediente vem do contato que originou a consulta.", (a) => !a.earlier);
    for (const status of ["attended", "no_show", "upcoming", "unverified"] as const) {
      cohort(status, COHORT_LABEL[status], d.schedule.cohort[status].total,
        "Avaliações criadas no mês. Consulta passada sem status comprovado é não verificada, nunca falta.", (a) => !a.earlier && a.status === status);
    }
    cohort("attendanceRate", "Taxa de comparecimento", d.schedule.attendanceRatePercent,
      "Compareceram ÷ (compareceram + faltaram). Consultas futuras, não verificadas e marcadas em meses anteriores ficam fora.",
      (a) => !a.earlier && (a.status === "attended" || a.status === "no_show"), formatPercent);
    cohort("earlierAttended", "Compareceram · meses anteriores", d.schedule.fromEarlierMonths.attended,
      "Avaliações criadas antes deste mês e realizadas neste mês, fora da coorte e da taxa.", (a) => a.earlier && a.status === "attended");
    cohort("earlierNoShow", "Faltaram · meses anteriores", d.schedule.fromEarlierMonths.noShow,
      "Avaliações criadas antes deste mês com falta marcada neste mês, fora da coorte e da taxa.", (a) => a.earlier && a.status === "no_show");
  }
  if (e.leadPopulation === "attended" && e.leads) {
    const cityRows = e.leads.filter((lead) => lead.city !== null);
    const head = ["Conversa (ID)", "Cidade declarada", "Área atendida", "Origem", "Mensagem (ID)", "Declarada em"];
    const rows = cityRows.map((lead) => ({ id: lead.leadId, cells: [lead.conversationId ?? "—", lead.city!,
      lead.verdict === "in" ? "Dentro" : lead.verdict === "out" ? "Fora" : "Não classificada",
      lead.cityMessageId ? "Declaração no histórico" : "Registro do agente", lead.cityMessageId ?? "—", lead.cityDeclaredAt ? when(lead.cityDeclaredAt) : "—"] }));
    add("withCity", "Informaram a cidade", d.leads.withCity,
      "Contatos atendidos no mês com cidade registrada ou declarada literalmente no histórico até o fim do mês. A mensagem é identificada, nunca exibida.", head, rows, "leads");
    add("outOfArea", "Fora da área atendida", d.leads.outOfArea,
      "A classificação usa a área cadastrada. Sem área, é não classificada, nunca dentro presumido.", head,
      rows.filter((_, i) => cityRows[i].verdict === "out"), "leads");
  }
  const messageHead = ["Mensagem (ID)", "Conversa (ID)", "Recebida em", "Tipo", "Duração medida"];
  const audioRows = e.messages.filter((m) => m.kind === "audio").map((m) => ({ id: m.messageId,
    cells: [m.messageId, m.conversationId, when(m.at), "Áudio", m.seconds === null ? "Não medida" : formatSpan(m.seconds)] }));
  const audioDescription = "Áudios do contato ouvidos e respondidos pelo agente. Sem duração medida não significa zero. Áudio sem transcrição fica fora.";
  add("audios", "Áudios ouvidos", d.service.time.audios, audioDescription, messageHead, audioRows, "messages");
  add("audioSeconds", "Tempo de áudio medido", d.service.time.audioSeconds, audioDescription, messageHead, audioRows, "messages", formatSpan);
  add("textMessages", "Mensagens de texto", d.service.time.textMessages,
    "Mensagens do contato respondidas primeiro pelo agente; o tempo de leitura e resposta usa a premissa por mensagem, não uma duração medida.", messageHead,
    e.messages.filter((m) => m.kind === "text").map((m) => ({ id: m.messageId, cells: [m.messageId, m.conversationId, when(m.at), "Texto", "—"] })), "messages");
  const eventHead = ["Evento (ID)", "Conversa (ID)", "Registrado em", "Procedimento"];
  for (const [key, label, kind, metric] of [
    ["qualified", "Qualificações registradas", "qualified", d.schedule.qualified.total],
    ["handoffs", "Transbordos registrados", "handoff", d.service.handoffEvents],
    ["unanswered", "Perguntas sem resposta registradas", "unanswered", d.unanswered],
  ] as const) {
    add(key, label, metric, "Eventos explicitamente registrados no mês. A lista não infere eventos do texto da conversa.", eventHead,
      e.events.filter((ev) => ev.kind === kind).map((ev) => ({ id: ev.eventId, cells: [ev.eventId, ev.conversationId, when(ev.at), ev.procedure ?? "—"] })), "events");
  }
  return entries;
}
