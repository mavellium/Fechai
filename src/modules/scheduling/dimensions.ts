/**
 * As dimensões de um agendamento, cada uma com a sua pergunta:
 *
 * | Dimensão           | Pergunta                                   | Onde mora                         |
 * | ------------------ | ------------------------------------------ | --------------------------------- |
 * | Tipo               | avaliação, retorno ou procedimento?        | `Appointment.kind`                |
 * | Horário de origem  | o contato chegou dentro do expediente?     | calculado na leitura (`originHours`) |
 * | Situação           | de pé, remarcada ou cancelada?             | `status` + `rescheduledAt`        |
 * | Confirmação        | o paciente confirmou que vem?              | `confirmedAt`                     |
 * | Comparecimento     | veio, faltou ou ninguém conferiu?          | `attendance`                      |
 * | Procedimento       | interesse em quê?                          | `procedure`                       |
 * | Origem             | quem marcou?                               | `source`                          |
 *
 * Antes tudo cabia em `status` (`scheduled | done | canceled`), e "concluído"
 * valia como "compareceu" — o relatório contava avaliação realizada sem
 * ninguém ter conferido. A regra que isto protege: **agendar ou confirmar
 * nunca é comparecer.** `attendance` nasce `unknown` e só muda por marcação
 * de alguém depois do horário.
 *
 * Puro de propósito: a tela, o relatório e os testes importam.
 */

export const APPOINTMENT_KINDS = ["evaluation", "return", "procedure"] as const;
export type AppointmentKind = (typeof APPOINTMENT_KINDS)[number];
export const KIND_LABELS: Record<AppointmentKind, string> = {
  evaluation: "Avaliação",
  return: "Retorno",
  procedure: "Procedimento",
};

export const ATTENDANCE_VALUES = ["unknown", "attended", "no_show"] as const;
export type Attendance = (typeof ATTENDANCE_VALUES)[number];
export const ATTENDANCE_LABELS: Record<Attendance, string> = {
  unknown: "Não verificado",
  attended: "Compareceu",
  no_show: "Faltou",
};

export type Situation = "scheduled" | "rescheduled" | "canceled";
export const SITUATION_LABELS: Record<Situation, string> = {
  scheduled: "Agendado",
  rescheduled: "Remarcado",
  canceled: "Cancelado",
};

export type AppointmentSource = "agent" | "manual" | "integration";
export const SOURCE_LABELS: Record<AppointmentSource, string> = {
  agent: "Agente",
  manual: "Humano",
  integration: "Integração",
};

export type OriginHours = "inside" | "outside" | "unclassified";
export const ORIGIN_HOURS_LABELS: Record<OriginHours, string> = {
  inside: "Dentro do horário",
  outside: "Fora do horário",
  unclassified: "Não classificado",
};

/** Sem acento nem caixa: "Avaliação", "avaliacao" e "evaluation" são o mesmo tipo. */
const KIND_ALIASES: Record<string, AppointmentKind> = {
  evaluation: "evaluation", avaliacao: "evaluation",
  return: "return", retorno: "return",
  procedure: "procedure", procedimento: "procedure",
};

/**
 * Lê um tipo de onde quer que venha (formulário, tool, banco). Valor fora da
 * lista vira `null` — "não classificado" —, nunca um tipo chutado.
 */
export function parseKind(value: unknown): AppointmentKind | null {
  if (typeof value !== "string") return null;
  const key = value.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
  return KIND_ALIASES[key] ?? null;
}

export function parseAttendance(value: unknown): Attendance | null {
  return typeof value === "string" && (ATTENDANCE_VALUES as readonly string[]).includes(value)
    ? (value as Attendance) : null;
}

/**
 * Comparecimento de uma linha, com o legado: `status: "done"` era o botão
 * "Concluir", que o relatório já lia como presença confirmada por humano.
 * Vale até o script de migração normalizar as linhas antigas.
 */
export function attendanceOf(a: { status: string; attendance?: string | null }): Attendance {
  if (a.status === "done") return "attended";
  return parseAttendance(a.attendance) ?? "unknown";
}

/** Cancelada vence; remarcada é a que já trocou de horário ao menos uma vez. */
export function situationOf(a: { status: string; rescheduledAt?: Date | null }): Situation {
  if (a.status === "canceled") return "canceled";
  return a.rescheduledAt ? "rescheduled" : "scheduled";
}

export function sourceOf(source: string): AppointmentSource {
  return source === "agent" || source === "integration" ? source : "manual";
}

/**
 * Comparecimento só se marca depois do horário marcado e numa consulta de pé:
 * "compareceu" antes da hora é previsão, e cancelada não tem a quem faltar.
 */
export function canMarkAttendance(a: { status: string; startsAt: Date }, now = new Date()): boolean {
  return a.status !== "canceled" && a.startsAt.getTime() <= now.getTime();
}

/** Confirmar só faz sentido para o que ainda vai acontecer. */
export function canConfirm(a: { status: string; startsAt: Date }, now = new Date()): boolean {
  return a.status === "scheduled" && a.startsAt.getTime() > now.getTime();
}

/**
 * Horário de origem: a primeira mensagem do contato caiu dentro ou fora do
 * expediente humano? Calculado na leitura, nunca gravado — o expediente é
 * premissa do relatório mensal e pode ser corrigido depois.
 *
 * `outside` recebe a regra de fora já pronta (`outsideHumanHours` com as
 * premissas), e devolve `null` quando o expediente não foi informado: aí é
 * "não classificado", jamais "dentro" presumido. A chegada precisa ser
 * anterior à marcação — contato que só escreveu depois não originou a consulta.
 */
export function originHours(
  firstInboundAt: Date | null | undefined,
  createdAt: Date,
  outside: (at: Date) => boolean | null,
): OriginHours {
  if (!firstInboundAt || firstInboundAt > createdAt) return "unclassified";
  const result = outside(firstInboundAt);
  return result === null ? "unclassified" : result ? "outside" : "inside";
}
