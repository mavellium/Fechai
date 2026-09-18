/**
 * Triagem: marcar um contato como "não é cliente em potencial".
 *
 * Existe porque `Lead.status: "lost"` responde outra pergunta. "Lost" é
 * "era cliente e não fechou" (quis, sumiu, escolheu outro). Desqualificado é
 * "nunca foi" — vendedor, trote, curioso, fora da área de atendimento. Somar
 * os dois num número só apagaria justamente o que a clínica quer ver: quantas
 * conversas o agente resolveu sem gastar o tempo de ninguém.
 *
 * O carimbo é sempre explícito (`Lead.disqualifiedAt`), nunca inferido do
 * texto da conversa: a métrica de economia em /relatorios é multiplicada por
 * dinheiro, e um palpite ali vira um número que o cliente confere e não bate.
 */

export type DisqualifyReason =
  | "fora_da_area"
  | "nao_e_paciente"
  | "spam"
  | "ja_e_paciente"
  | "outro";

export const DISQUALIFY_REASONS: { key: DisqualifyReason; label: string; hint: string }[] = [
  {
    key: "fora_da_area",
    label: "Fora da área de atendimento",
    hint: "Outra cidade/região, não dá para atender presencialmente.",
  },
  {
    key: "nao_e_paciente",
    label: "Não procura atendimento",
    hint: "Vendedor, parceria, currículo, cobrança — não é paciente.",
  },
  {
    key: "spam",
    label: "Spam ou trote",
    hint: "Mensagem automática, engano ou brincadeira.",
  },
  {
    key: "ja_e_paciente",
    label: "Assunto administrativo",
    hint: "Já é paciente e só precisa de algo que não é agendamento novo.",
  },
  { key: "outro", label: "Outro motivo", hint: "Não se encaixa nos anteriores." },
];

const REASON_KEYS = new Set<string>(DISQUALIFY_REASONS.map((r) => r.key));

/** Rótulo para a UI. Motivo desconhecido (linha antiga) cai em "Outro motivo". */
export function reasonLabel(reason: string | null | undefined): string {
  return DISQUALIFY_REASONS.find((r) => r.key === reason)?.label ?? "Outro motivo";
}

/**
 * Normaliza o que o LLM mandou. Nunca lança e nunca recusa a desqualificação
 * por causa do motivo: o valor do carimbo é a triagem em si, o motivo é o
 * detalhe. Valor fora da lista vira `"outro"`.
 */
export function parseReason(value: unknown): DisqualifyReason {
  if (typeof value === "string" && REASON_KEYS.has(value)) return value as DisqualifyReason;
  return "outro";
}

// ---------------------------------------------------------------------------
// Custo do atendimento manual (base da conversão triagem → dinheiro)
// ---------------------------------------------------------------------------

export type AttendanceCost = {
  minutesPerLead: number;
  hourlyCostCents: number;
};

/**
 * Tetos de sanidade. Não são regra de negócio — são proteção contra o dedo
 * escorregando no formulário e um "R$ 900.000/hora" virando uma economia de
 * milhões no relatório do cliente.
 */
export const MAX_MINUTES_PER_LEAD = 480; // 8h com um único contato já é absurdo
export const MAX_HOURLY_COST_CENTS = 100_000_00; // R$ 100.000/hora

export function isValidAttendanceCost(input: {
  minutesPerLead: number;
  hourlyCostCents: number;
}): boolean {
  const { minutesPerLead, hourlyCostCents } = input;
  return (
    Number.isInteger(minutesPerLead) &&
    minutesPerLead > 0 &&
    minutesPerLead <= MAX_MINUTES_PER_LEAD &&
    Number.isInteger(hourlyCostCents) &&
    hourlyCostCents > 0 &&
    hourlyCostCents <= MAX_HOURLY_COST_CENTS
  );
}

/**
 * Custo em centavos de atender UM contato à mão.
 *
 * Arredonda uma vez, no fim: multiplicar primeiro e dividir depois evita que
 * 8 min × R$ 30/h vire R$ 4,00 em vez de R$ 4,00 por erro de centavo acumulado
 * em cada lead.
 */
export function costPerLeadCents(cost: AttendanceCost): number {
  return Math.round((cost.hourlyCostCents * cost.minutesPerLead) / 60);
}

/** Resumo de uma linha para a UI ("8 min × R$ 30,00/h"). */
export function describeAttendanceCost(cost: AttendanceCost, formatBRL: (c: number) => string) {
  return `${cost.minutesPerLead} min × ${formatBRL(cost.hourlyCostCents)}/h`;
}
