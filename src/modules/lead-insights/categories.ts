/**
 * Categorias da inteligência de conversas (MVP): conjunto fixo de dúvidas e de
 * motivos de perda. São chaves de texto, não enum do banco — a fase seguinte
 * deixa a equipe aprovar categorias novas sugeridas pelo agente, e um enum do
 * Postgres exigiria migration para cada valor.
 *
 * O agente escolhe a chave e, se nenhuma serve, "outro" com uma frase curta
 * (`*Text`). Valor fora da lista vira "outro" — nunca recusa o registro: perder
 * a conversa inteira porque o modelo inventou uma string trocaria o dado pelo
 * enfeite (mesma regra de `disqualify.ts`).
 */

export type Category = { key: string; label: string; hint: string };

/** Primeira dúvida real, depois da mensagem padrão do anúncio. */
export const DOUBT_CATEGORIES: Category[] = [
  { key: "localizacao", label: "Localização", hint: "Onde fica, se atende em determinada cidade, como chegar." },
  { key: "preco", label: "Preço", hint: "Quanto custa, valor da avaliação ou do tratamento." },
  { key: "convenio", label: "Convênio", hint: "Se aceita convênio ou plano." },
  { key: "pagamento", label: "Forma de pagamento", hint: "Parcelamento, entrada, cartão." },
  { key: "horario", label: "Horário", hint: "Dias e horários de atendimento." },
  { key: "procedimento", label: "Procedimento", hint: "Como funciona, se a clínica faz determinado tratamento, indicação." },
  { key: "outro", label: "Outra dúvida", hint: "Não se encaixa nas anteriores." },
];

/** Motivos de perda que o AGENTE pode registrar (o contato disse). */
export const LOSS_CATEGORIES: Category[] = [
  { key: "fora_da_regiao", label: "Fora da região", hint: "Queria atendimento em outra cidade/região." },
  { key: "preco", label: "Achou caro", hint: "Disse que o valor não cabe ou comparou preço." },
  { key: "convenio", label: "Sem convênio", hint: "Só atende por convênio/plano que a clínica não aceita." },
  { key: "horario", label: "Horário não serve", hint: "Os horários oferecidos não combinam com os dele." },
  { key: "concorrente", label: "Escolheu outra clínica", hint: "Disse que vai ou foi em outro lugar." },
  { key: "adiou", label: "Vai pensar / adiou", hint: "Não quer decidir agora." },
  { key: "sem_interesse", label: "Sem interesse", hint: "Só pesquisando, mudou de ideia ou pediu para parar." },
  { key: "outro", label: "Outro motivo", hint: "Não se encaixa nos anteriores." },
];

/**
 * "Parou de responder": não é o agente que declara (ele não vê o silêncio
 * acontecer), o sistema deriva do tempo sem resposta. Fica fora da lista que o
 * agente recebe, mas tem rótulo para o painel e o relatório.
 */
export const IDLE_LOSS_KEY = "sumiu";
export const IDLE_LOSS_LABEL = "Parou de responder";

const DOUBT_KEYS = new Set(DOUBT_CATEGORIES.map((c) => c.key));
const LOSS_KEYS = new Set(LOSS_CATEGORIES.map((c) => c.key));

/** Chave conhecida ou "outro". `null` quando o campo nem veio. */
export function parseDoubtCategory(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const key = value.trim();
  return DOUBT_KEYS.has(key) ? key : "outro";
}

export function parseLossCategory(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const key = value.trim();
  return LOSS_KEYS.has(key) ? key : "outro";
}

export function doubtLabel(key: string | null | undefined): string {
  return DOUBT_CATEGORIES.find((c) => c.key === key)?.label ?? "Outra dúvida";
}

/** Motivo de perda: os do agente, o derivado "parou de responder" e, para linha antiga ou desconhecida, "Outro motivo". */
export function lossLabel(key: string | null | undefined): string {
  if (key === IDLE_LOSS_KEY) return IDLE_LOSS_LABEL;
  return LOSS_CATEGORIES.find((c) => c.key === key)?.label ?? "Outro motivo";
}
