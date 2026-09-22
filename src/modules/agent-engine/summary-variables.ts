/**
 * Extração de variáveis a partir do resumo da conversa.
 *
 * As variáveis se preenchem durante o turno, quando o agente chama
 * `remember_variables`. Isso deixa de fora todo o passado: conversa anterior à
 * variável existir, conversa atendida à mão, conversa em que o agente não
 * chamou a tool. O dado está escrito no histórico, mas a tela diz "não
 * informado".
 *
 * Resumir já relê a conversa inteira e já é uma chamada paga que o dono pediu.
 * Pedir os valores no MESMO retorno recupera esse passado sem custo extra —
 * daí o modelo responder o resumo e, no fim, um bloco delimitado com os valores
 * que encontrou.
 *
 * O bloco é **arrancado** do texto antes de o resumo ser exibido ou salvo: ele
 * é protocolo interno, não faz parte do que o dono da conta pediu para ler.
 */
import type { ConversationVariables, VariableDefinition } from "./variable-definitions";

/**
 * Delimitador em vez de "responda em JSON": o resumo é texto livre para leitura
 * humana, e pedir o documento inteiro em JSON degradaria a parte que importa.
 * Um bloco no fim é o que um modelo de qualquer porte acerta com consistência.
 */
const BLOCK = /<variaveis>([\s\S]*?)<\/variaveis>/i;

/** Uma linha por variável: `chave: valor`. Sem aninhamento, sem escape. */
const LINE = /^([a-z][a-z0-9_]{1,39})\s*:\s*(.+)$/i;

/**
 * O modelo escreve isto quando não encontrou o dado. É a forma de ele dizer
 * "não sei" sem inventar — sem uma saída explícita, um modelo pressionado a
 * preencher todo campo preenche com plausibilidade, que é exatamente o erro
 * que esta funcionalidade não pode cometer com dado de cliente.
 */
const UNKNOWN = /^(não informado|nao informado|desconhecido|n\/a|-|null|nenhum|vazio)$/i;

export function variableExtractionPrompt(definitions: VariableDefinition[]): string {
  if (!definitions.length) return "";
  const lines = definitions.map(({ key, description }) => `- ${key}: ${description}`);
  return [
    "",
    "Depois do resumo, acrescente um bloco exatamente neste formato:",
    "",
    "<variaveis>",
    "chave: valor",
    "</variaveis>",
    "",
    "Preencha uma linha para cada dado abaixo que o CLIENTE tenha informado ao longo da conversa:",
    ...lines,
    "",
    'Regras do bloco: use o valor exatamente como o cliente informou, sem reformular. Se o dado não aparece na conversa, escreva "não informado" — nunca deduza, nunca preencha com o que é provável. Não inclua chaves fora da lista. O bloco é lido por um programa e não é mostrado a ninguém.',
  ].join("\n");
}

/**
 * Separa o resumo legível dos valores extraídos.
 *
 * Nada aqui lança: o retorno do modelo é texto probabilístico e um bloco
 * malformado não pode custar ao dono da conta o resumo que ele pagou. Na
 * dúvida, devolve o resumo e nenhuma variável.
 */
export function splitSummaryAndVariables(
  raw: string,
  definitions: VariableDefinition[],
): { summary: string; values: ConversationVariables } {
  const match = raw.match(BLOCK);
  // O bloco sai do texto mesmo quando não há nada aproveitável dentro; deixá-lo
  // no resumo mostraria protocolo interno ao dono da conta.
  const summary = (match ? raw.replace(match[0], "") : raw).trim();
  if (!match) return { summary, values: {} };

  const allowed = new Map(definitions.map((item) => [item.key, item]));
  const values: ConversationVariables = {};
  for (const line of match[1].split("\n")) {
    const parsed = line.trim().match(LINE);
    if (!parsed) continue;
    const key = parsed[1].toLowerCase();
    // `numero` é controlado pelo sistema (vem do telefone do contato) e chave
    // não definida para este agente não pode entrar pela porta dos fundos.
    if (key === "numero" || !allowed.has(key)) continue;
    const value = parsed[2].trim().replace(/^["']|["']$/g, "").trim();
    if (!value || UNKNOWN.test(value) || /\{\{|\}\}/.test(value)) continue;
    values[key] = value.slice(0, 500);
  }
  return { summary, values };
}
