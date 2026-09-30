import { formatBRL } from "@/lib/format";
import { normalizeLabel } from "./monthly-config";
import type { MonthlyReport } from "./monthly";
import type { MonthlyEvidence } from "./monthly-evidence";

/**
 * "Tempo que o Fechai devolveu para sua equipe" — o bloco do ROI mensal que
 * mostra o trabalho da recepção assumido pelo agente: áudios ouvidos, mensagens
 * respondidas e quanto dura um atendimento até agendar. Funções puras,
 * compartilhadas pelo painel, pelo fechamento e pelo PDF.
 */

/** Áudio acima disto é "longo" no relatório. */
export const LONG_AUDIO_SECONDS = 120;
/**
 * Um atendimento termina depois de 24h sem mensagem — o mesmo prazo da janela
 * de atendimento do WhatsApp. A conversa é uma só por contato, para sempre, e
 * não tem "fim" registrado; sem um corte, a duração média seria a idade do contato.
 */
export const SESSION_GAP_MS = 24 * 60 * 60 * 1000;
/** Limite do caso do mês: duas linhas no PDF, que tem uma página só. */
export const FEATURED_CASE_MAX = 240;

export type DurationStats = { count: number; averageMinutes: number | null; medianMinutes: number | null; averageMessages: number | null };
export type SessionOutcome = "scheduled" | "handoff" | "lost" | "other";
export type MonthlyTimeMetrics = {
  /** Mensagens de texto do contato respondidas pelo agente no mês. */
  textMessages: number;
  /** Áudios do contato que o agente ouviu (transcritos) e respondeu. */
  audios: number;
  /** Soma das durações medidas desses áudios, em minutos. */
  audioMinutes: number;
  /** Desses áudios, os sem duração medida (anteriores à medição ou formato não lido). */
  unmeasuredAudios: number;
  /** Acima de `LONG_AUDIO_SECONDS`. */
  longAudios: number;
  longestAudioSeconds: number | null;
  /** Atendimentos iniciados no mês com resposta do agente, por resultado. */
  sessions: Record<"all" | SessionOutcome, DurationStats>;
  /** Da primeira mensagem do atendimento até o agendamento feito pelo agente. */
  toSchedule: DurationStats;
};

export type TimeMessage = {
  /** Só para a lista de registros do painel (`monthly-evidence.ts`). */
  id?: string;
  role: string; sentBy: string | null; createdAt: Date;
  /** Presente só em mensagem de áudio. `heard` = a IA recebeu a transcrição. */
  audio?: { seconds: number | null; heard: boolean } | null;
};
export type TimeConversation = {
  id: string; leadId: string; lead: { status?: string; disqualifiedAt?: Date | null }; messages: TimeMessage[];
};
export type TimeAppointment = { conversationId: string | null; leadId: string | null; source: string; status: string; createdAt: Date };
export type TimeEvent = { conversationId: string; kind: string; createdAt: Date };

const round = (value: number, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;
function stats(rows: { minutes: number; messages: number }[]): DurationStats {
  if (!rows.length) return { count: 0, averageMinutes: null, medianMinutes: null, averageMessages: null };
  const minutes = rows.map((r) => r.minutes).sort((a, b) => a - b);
  const middle = Math.floor(minutes.length / 2);
  return {
    count: rows.length,
    averageMinutes: round(minutes.reduce((sum, v) => sum + v, 0) / rows.length),
    medianMinutes: round(minutes.length % 2 ? minutes[middle] : (minutes[middle - 1] + minutes[middle]) / 2),
    averageMessages: round(rows.reduce((sum, r) => sum + r.messages, 0) / rows.length),
  };
}

/**
 * `conversations` já vem filtrada pelo escopo de agentes do relatório.
 *
 * Uma mensagem do contato conta como "respondida pelo agente" quando a primeira
 * resposta depois dela é da IA — se um humano respondeu primeiro, o trabalho
 * foi da equipe. Áudio que a IA não ouviu (sem transcrição) nunca conta.
 */
export function calculateTimeMetrics(input: {
  start: Date; end: Date; conversations: TimeConversation[]; appointments: TimeAppointment[]; events: TimeEvent[];
}, evidence?: Pick<MonthlyEvidence, "messages" | "messagesExcluded">): MonthlyTimeMetrics {
  const { start, end } = input;
  const inMonth = (at: Date) => at >= start && at < end;
  let textMessages = 0, audios = 0, audioSeconds = 0, unmeasuredAudios = 0, longAudios = 0;
  let longestAudioSeconds: number | null = null;
  const done: { outcome: SessionOutcome; minutes: number; messages: number; schedule: { minutes: number; messages: number } | null }[] = [];
  // Cancelado não conta como agendado, como no restante do relatório.
  const booked = input.appointments.filter((a) => a.source === "agent" && a.status !== "canceled")
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const handoffs = input.events.filter((e) => e.kind === "handoff");

  for (const conversation of input.conversations) {
    const messages = [...conversation.messages].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    let waiting: TimeMessage[] = [];
    const record = (w: TimeMessage, kind: "text" | "audio") => evidence?.messages.push({
      messageId: w.id ?? "", conversationId: conversation.id, at: w.createdAt.toISOString(), kind, seconds: w.audio?.seconds ?? null });
    for (const m of messages) {
      if (m.role === "user") { waiting.push(m); continue; }
      if (m.role !== "assistant" || (m.sentBy !== "agent" && m.sentBy !== "human")) continue;
      if (m.sentBy === "human" && evidence) evidence.messagesExcluded.humanFirst += waiting.filter((w) => inMonth(w.createdAt)).length;
      if (m.sentBy === "agent") for (const w of waiting) {
        if (!inMonth(w.createdAt)) continue;
        if (!w.audio) { textMessages++; record(w, "text"); continue; }
        if (!w.audio.heard) { if (evidence) evidence.messagesExcluded.unheardAudio++; continue; }
        audios++;
        record(w, "audio");
        if (w.audio.seconds === null) { unmeasuredAudios++; continue; }
        audioSeconds += w.audio.seconds;
        if (w.audio.seconds > LONG_AUDIO_SECONDS) longAudios++;
        longestAudioSeconds = Math.max(longestAudioSeconds ?? 0, w.audio.seconds);
      }
      waiting = [];
    }
    if (evidence) evidence.messagesExcluded.noReply += waiting.filter((w) => inMonth(w.createdAt)).length;

    // Atendimento começa numa mensagem do contato; mensagem nossa depois de
    // 24h de silêncio (follow-up, lembrete, disparo) não abre atendimento.
    const sessions: { start: Date; last: Date; messages: TimeMessage[]; agent: boolean }[] = [];
    for (const m of messages) {
      const current = sessions.at(-1);
      if (current && m.createdAt.getTime() - current.last.getTime() < SESSION_GAP_MS) {
        current.last = m.createdAt;
        current.messages.push(m);
      } else if (m.role === "user") {
        sessions.push({ start: m.createdAt, last: m.createdAt, messages: [m], agent: false });
      } else continue;
      if (m.role === "assistant" && m.sentBy === "agent") sessions.at(-1)!.agent = true;
    }
    const mine = (a: TimeAppointment) => a.conversationId ? a.conversationId === conversation.id : a.leadId === conversation.leadId;
    sessions.forEach((session, index) => {
      if (!session.agent || !inMonth(session.start)) return;
      // Até 24h depois da última mensagem ainda é este atendimento (a reação do
      // atendente, por exemplo, não é mensagem); o próximo começa depois disso.
      const until = session.last.getTime() + SESSION_GAP_MS;
      const within = (at: Date) => at >= session.start && at.getTime() < until;
      const appointment = booked.find((a) => mine(a) && within(a.createdAt));
      // Perdido é estado atual do contato, sem data: só vale no último atendimento.
      // Desqualificado não é perdido — nunca foi paciente em potencial.
      const lost = index === sessions.length - 1 && conversation.lead.status === "lost" && !conversation.lead.disqualifiedAt;
      const outcome: SessionOutcome = appointment ? "scheduled"
        : handoffs.some((e) => e.conversationId === conversation.id && within(e.createdAt)) ? "handoff"
        : lost ? "lost" : "other";
      done.push({
        outcome,
        minutes: (session.last.getTime() - session.start.getTime()) / 60_000,
        messages: session.messages.length,
        schedule: appointment ? {
          minutes: (appointment.createdAt.getTime() - session.start.getTime()) / 60_000,
          messages: session.messages.filter((m) => m.createdAt <= appointment.createdAt).length,
        } : null,
      });
    });
  }

  const by = (outcome: SessionOutcome) => stats(done.filter((s) => s.outcome === outcome));
  return {
    textMessages, audios, audioMinutes: round(audioSeconds / 60, 2), unmeasuredAudios, longAudios, longestAudioSeconds,
    sessions: { all: stats(done), scheduled: by("scheduled"), handoff: by("handoff"), lost: by("lost"), other: by("other") },
    toSchedule: stats(done.flatMap((s) => s.schedule ? [s.schedule] : [])),
  };
}

/**
 * Horas que a recepção gastaria: ouvir cada áudio inteiro + ler e responder
 * cada mensagem (texto ou áudio) no tempo declarado nas premissas.
 */
export function returnedHours(time: Pick<MonthlyTimeMetrics, "audioMinutes" | "textMessages" | "audios">, secondsPerMessage: number) {
  return (time.audioMinutes * 60 + (time.textMessages + time.audios) * secondsPerMessage) / 3600;
}

/** 45s · 4min16s · 3h12 · 18h · 3d 4h */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total}s`;
  if (total < 3600) {
    const m = Math.floor(total / 60), s = total % 60;
    return s ? `${m}min${String(s).padStart(2, "0")}s` : `${m}min`;
  }
  const minutes = Math.round(total / 60), h = Math.floor(minutes / 60), m = minutes % 60;
  if (h >= 48) return h % 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h / 24}d`;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}
export const formatMinutes = (minutes: number | null | undefined) => formatDuration(minutes == null ? null : minutes * 60);

/** "Este mês o agente ouviu 3h12 de áudios e atendeu 214 conversas, o equivalente a 18h de trabalho da recepção (R$ X)." */
export function timeHeadline(time: MonthlyTimeMetrics, conversations: number, hours: number | null, savingsCents: number | null) {
  const heard = time.audioMinutes > 0 ? `ouviu ${formatMinutes(time.audioMinutes)} de áudios`
    : time.audios ? `ouviu ${time.audios} ${time.audios === 1 ? "áudio" : "áudios"}` : "";
  const talked = `atendeu ${conversations} ${conversations === 1 ? "conversa" : "conversas"}`;
  const worth = hours === null ? "" : `, o equivalente a ${formatDuration(hours * 3600)} de trabalho da recepção${savingsCents === null ? "" : ` (${formatBRL(savingsCents)})`}`;
  return `Este mês o agente ${heard ? `${heard} e ` : ""}${talked}${worth}.`;
}

const num = (v: number | null, suffix = "") => v === null ? "Pendente" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}${suffix}`;

/**
 * De onde vêm as horas devolvidas do mês, na ordem em que a economia as
 * escolhe. `short` é a versão do PDF, onde cada linha a mais pesa.
 */
export function hoursPremise(r: Pick<MonthlyReport, "current" | "assumptions" | "metricOverrides">, short = false): string {
  const a = r.current, c = r.assumptions, t = a.time;
  if (r.metricOverrides?.current.assumedHours !== undefined) return `${num(a.assumedHours, " h")} informadas manualmente`;
  if (c.secondsPerMessage != null && t) {
    return short
      ? `${t.audioMinutes ? `${formatMinutes(t.audioMinutes)} de áudio + ` : ""}(${t.textMessages} msg + ${t.audios} áudios) × ${num(c.secondsPerMessage, " s")}`
      : `${t.audioMinutes ? `${formatMinutes(t.audioMinutes)} de áudio ouvido + ` : ""}(${t.textMessages} mensagens + ${t.audios} áudios) × ${num(c.secondsPerMessage, " s")} de leitura e resposta`;
  }
  return `${a.aiOnlyConversations} conversas sem resposta humana × ${num(c.minutesPerConversation, " min")} ÷ 60`;
}

/** Palavras de nome de contato que também são tratamento ou parentesco, não identidade. */
const GENERIC_WORDS = new Set(["paciente", "cliente", "contato", "senhora", "senhor", "dona", "doutor", "doutora",
  "dra", "sra", "srta", "dos", "das", "mae", "pai", "filho", "filha", "clinica", "odonto"]);
const words = (text: string) => normalizeLabel(text).split(/[^a-z]+/).filter(Boolean);

/**
 * O caso do mês vai para o decisor da clínica e para o PDF: só perfil genérico.
 * Recusa e-mail, sequência de 8+ dígitos (telefone, CPF) e qualquer palavra
 * do nome de um contato atendido no mês. Devolve o motivo, ou null se passou.
 */
export function featuredCaseProblem(text: string, contactNames: (string | null)[]): string | null {
  if (text.length > FEATURED_CASE_MAX) return `Use até ${FEATURED_CASE_MAX} caracteres no caso do mês para caber em uma página.`;
  if (/\S+@\S+\.\S+/.test(text)) return "Tire o e-mail do caso do mês: use só o perfil genérico do paciente.";
  if (/(?:\d[\s().-]*){8,}/.test(text)) return "Tire telefone ou documento do caso do mês: use só o perfil genérico do paciente.";
  const used = new Set(words(text));
  for (const name of contactNames) {
    for (const word of words(name ?? "")) {
      if (word.length >= 3 && !GENERIC_WORDS.has(word) && used.has(word)) {
        return `O caso do mês cita "${word}", que é nome de um contato atendido neste mês. Use só o perfil genérico (ex.: "paciente de 74 anos").`;
      }
    }
  }
  return null;
}
