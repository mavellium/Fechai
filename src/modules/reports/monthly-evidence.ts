import type { LeadOutcome } from "@/modules/lead-insights/summary";

/**
 * Os registros por trás de cada número do ROI mensal. Saem da MESMA passada de
 * `calculateMonthlyMetrics` (nunca de uma segunda consulta com outra regra), vão
 * congelados no snapshot junto com os números e aparecem no painel quando a
 * pessoa clica no indicador. O PDF não leva nada daqui — só o selo de qualidade.
 *
 * Só identificadores, datas e classificações: nenhum nome, telefone ou texto de
 * conversa. Datas em ISO, porque o snapshot é JSON.
 */

export type Bucket = "inside" | "outside" | "unclassified";

/** Conversa com mensagem do contato no mês. `counted` = entrou em "conversas respondidas". */
export type ConversationEvidence = {
  conversationId: string;
  /** Chegada que classificou o horário: a primeira mensagem do contato respondida no mês. */
  arrivalAt: string | null;
  bucket: Bucket;
  counted: boolean;
  /** Por que ficou fora: só a equipe respondeu, ou ninguém respondeu no mês. */
  excluded: "human_only" | "no_reply" | null;
  /** Contato criado no mês (entra em "novos contatos atendidos" se `counted`). */
  newContact: boolean;
  /** Sem resposta humana no mês (base da estimativa de horas por conversa). */
  aiOnly: boolean;
};

/** Um par por conversa: a primeira mensagem pendente e a primeira resposta a ela. */
export type ResponseEvidence = { conversationId: string; inboundAt: string; replyAt: string; seconds: number; by: "agent" | "human" };

export type AppointmentScheduled = "counted" | "counted_untyped" | "other_month" | "canceled" | "not_evaluation" | "untyped";
export type AppointmentAttended = "attended" | "not_attended" | "unknown" | "future" | "other_month" | "canceled" | "canceled_external" | "not_evaluation" | "untyped";
export type AppointmentEvidence = {
  appointmentId: string; conversationId: string | null;
  createdAt: string; startsAt: string; createdInMonth: boolean; startsInMonth: boolean;
  serviceType: string | null; status: string; procedure: string | null;
  /** Tipo explícito (`Appointment.kind`); vence `serviceType`. Ausente em snapshot antigo. */
  kind?: string | null;
  /** Vínculo com o Clinicorp e o status lido lá (id do tipo de status), quando há. */
  clinicorp: { linked: boolean; statusType: string | null };
  arrivalAt: string | null; bucket: Bucket;
  scheduled: AppointmentScheduled; attended: AppointmentAttended;
};

export type EventEvidence = { eventId: string; conversationId: string; kind: "qualified" | "handoff" | "unanswered"; at: string; procedure: string | null };
export type MessageEvidence = { messageId: string; conversationId: string; at: string; kind: "text" | "audio"; seconds: number | null };
export type GapEvidence = { gapId: string; firstAskedAt: string; answeredAt: string; seconds: number };
export type LeadEvidence = {
  leadId: string; conversationId: string | null; createdAt: string;
  city: string | null; verdict: "in" | "out" | "unknown" | null;
  outcome: LeadOutcome; lossKey: string | null; doubtKey: string | null;
};

export type MonthlyEvidence = {
  version: 1;
  conversations: ConversationEvidence[];
  responses: ResponseEvidence[];
  appointments: AppointmentEvidence[];
  events: EventEvidence[];
  /** Mensagens do contato que o agente respondeu (texto e áudio ouvido). */
  messages: MessageEvidence[];
  /** Mensagens do contato no mês que ficaram fora da conta, por motivo. */
  messagesExcluded: { humanFirst: number; unheardAudio: number; noReply: number };
  /** Mensagens recebidas por hora local (0–23): a base dos horários de pico. */
  hours: number[];
  gaps: GapEvidence[];
  leads?: LeadEvidence[];
  /** Listas cortadas em `EVIDENCE_LIMIT`, com o total real. */
  truncated: Partial<Record<"conversations" | "responses" | "appointments" | "events" | "messages" | "leads", number>>;
};

/**
 * Teto por lista. O snapshot é uma linha JSON e o painel embute a tabela; uma
 * clínica com dezenas de milhares de mensagens no mês não pode travar os dois.
 * O número do relatório nunca é cortado — só a lista que o explica.
 */
export const EVIDENCE_LIMIT = 5000;

export const emptyEvidence = (): MonthlyEvidence => ({
  version: 1, conversations: [], responses: [], appointments: [], events: [], messages: [],
  messagesExcluded: { humanFirst: 0, unheardAudio: 0, noReply: 0 }, hours: Array.from({ length: 24 }, () => 0), gaps: [], truncated: {},
});

/** Corta as listas longas no teto e anota o total. Muta e devolve o mesmo objeto. */
export function capEvidence(evidence: MonthlyEvidence): MonthlyEvidence {
  for (const key of ["conversations", "responses", "appointments", "events", "messages", "leads"] as const) {
    const list = evidence[key];
    if (list && list.length > EVIDENCE_LIMIT) {
      evidence.truncated[key] = list.length;
      (evidence[key] as unknown[]) = list.slice(0, EVIDENCE_LIMIT);
    }
  }
  return evidence;
}

export const BUCKET_LABEL: Record<Bucket, string> = { inside: "Dentro", outside: "Fora", unclassified: "Sem classificação" };

/** Por que o horário ficou sem classificação — a chegada faltou ou o expediente não foi informado. */
export function bucketReason(bucket: Bucket, arrivalAt: string | null): string | null {
  if (bucket !== "unclassified") return null;
  return arrivalAt ? "expediente humano não informado" : "sem mensagem do contato antes da marcação";
}

export const SCHEDULED_LABEL: Record<AppointmentScheduled, string> = {
  counted: "Contou: criado pelo agente no mês, tipo de avaliação",
  counted_untyped: "Contou: sem tipo, conferido como avaliação",
  other_month: "Fora: marcado em outro mês",
  canceled: "Fora: cancelado",
  not_evaluation: "Fora: o tipo não é avaliação",
  untyped: "Fora: sem tipo, aguarda conferência",
};
export const ATTENDED_LABEL: Record<AppointmentAttended, string> = {
  attended: "Contou: comparecimento confirmado",
  not_attended: "Fora: status não comprova comparecimento",
  unknown: "Pendente: comparecimento não confirmado",
  future: "Fora: consulta ainda não aconteceu",
  other_month: "Fora: consulta em outro mês",
  canceled: "Fora: cancelado",
  canceled_external: "Fora: cancelado no Clinicorp",
  not_evaluation: "Fora: o tipo não é avaliação",
  untyped: "Fora: sem tipo, aguarda conferência",
};
export const isScheduledCounted = (a: AppointmentEvidence) => a.scheduled === "counted" || a.scheduled === "counted_untyped";
