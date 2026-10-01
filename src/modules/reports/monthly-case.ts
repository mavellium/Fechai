import { z } from "zod";
import { formatDuration } from "./monthly-time";

/*
 * Fatos do caso do mês: o que dá para medir da conversa escolhida, ao lado do
 * texto escrito pela Mavellium. Idade (informada por quem leu a conversa),
 * duração de cada áudio, dia da semana e período. O caso pode ser de um contato
 * que não agendou: o valor está no tempo e na paciência que o agente absorveu.
 *
 * Nunca nome, telefone nem data exata. Duração, dia e período são lidos no
 * servidor, da conversa escolhida — o formulário só diz qual conversa e a
 * idade. Puro.
 */

export const CASE_PERIODS = ["dawn", "morning", "afternoon", "night"] as const;
export type CasePeriod = typeof CASE_PERIODS[number];
/** Com a preposição: "sábado à noite", "terça de manhã". */
export const PERIOD_LABEL: Record<CasePeriod, string> = { dawn: "de madrugada", morning: "de manhã", afternoon: "à tarde", night: "à noite" };
export const WEEKDAY_LABEL = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
export const casePeriod = (hour: number): CasePeriod => hour < 6 ? "dawn" : hour < 12 ? "morning" : hour < 18 ? "afternoon" : "night";

export const CASE_AUDIOS_MAX = 12;
export const caseFactsSchema = z.object({
  /** Conversa de onde os fatos foram lidos. Só para a revisão; nunca é impressa. */
  conversationId: z.string().trim().min(1).max(100),
  age: z.number().int().min(1).max(120).nullable(),
  audioSeconds: z.array(z.number().finite().min(0).max(7200)).max(CASE_AUDIOS_MAX),
  weekday: z.number().int().min(0).max(6),
  period: z.enum(CASE_PERIODS),
  /** O contato agendou pelo agente neste mês. */
  scheduled: z.boolean(),
}).strict();
export type CaseFacts = z.infer<typeof caseFactsSchema>;

/** Nunca lança: a coluna pode estar vazia, antiga ou editada à mão. */
export function parseCaseFacts(raw: unknown): CaseFacts | null {
  const parsed = caseFactsSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** "76 anos" · "sábado à noite" · "2 áudios: 5min02s e 4min40s (9min42s)" · "não agendou" */
export function caseFactItems(facts: CaseFacts): string[] {
  const audios = facts.audioSeconds, total = audios.reduce((sum, s) => sum + s, 0);
  const list = audios.map((s) => formatDuration(s));
  const joined = list.length > 1 ? `${list.slice(0, -1).join(", ")} e ${list.at(-1)}` : list[0];
  return [
    ...(facts.age === null ? [] : [`${facts.age} anos`]),
    `${WEEKDAY_LABEL[facts.weekday]} ${PERIOD_LABEL[facts.period]}`,
    ...(audios.length ? [audios.length === 1 ? `1 áudio de ${joined}` : `${audios.length} áudios: ${joined} (${formatDuration(total)} no total)`] : []),
    facts.scheduled ? "agendou" : "não agendou",
  ];
}
