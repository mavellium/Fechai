/**
 * Remove variáveis de template que o modelo eventualmente copiar do prompt.
 *
 * A instrução da persona reduz muito esse risco, mas não é uma garantia: o
 * texto final ainda vem de um modelo probabilístico. Esta função é a última
 * barreira determinística antes de a resposta ser persistida e enviada.
 */
const HANDLEBARS_PLACEHOLDER = /\{\{\s*[^{}\r\n]{1,80}\s*\}\}/gu;

const BRACKET_PLACEHOLDER =
  /\[\s*(?:nome|name|cpf|telefone|phone(?:_number)?|remote_jid|procedimento|queixa|sintomas?|observa(?:ç|c)(?:ão|oes|ões)|data|dia|hor[aá]rio|cidade|endere(?:ç|c)o|valor)(?:[\s_-]+[^\]\r\n]{1,60})?\s*\]/giu;

export function sanitizeUnresolvedPlaceholders(reply: string, values: Record<string, string> = {}): string {
  // Quando um campo inteiro está sem valor, remova também o rótulo. Só
  // retirar o token deixaria "Endereço:." na mensagem.
  const withoutEmptyFields = reply.replace(
    /(^|[.!?][ \t]+|\n)([^\n.!?]{1,40}):[ \t]*(\{\{[ \t]*[^{}\r\n]{1,80}[ \t]*\}\})[.!?]?/gu,
    (full, prefix: string, _label: string, token: string) => {
      const key = token.slice(2, -2).trim().toLowerCase();
      return values[key]?.trim() ? full : prefix;
    },
  );
  const withoutPlaceholders = withoutEmptyFields
    .replace(HANDLEBARS_PLACEHOLDER, (token) => {
      const key = token.slice(2, -2).trim().toLowerCase();
      return values[key]?.trim() ?? "";
    })
    .replace(HANDLEBARS_PLACEHOLDER, "")
    .replace(BRACKET_PLACEHOLDER, "");

  // Respostas comuns devem atravessar esta barreira sem nenhuma reescrita.
  if (withoutPlaceholders === reply) return reply.trim();

  const cleaned = withoutPlaceholders
    // "Claro, [Nome]!" não pode virar "Claro,!".
    .replace(/[ \t]+([,.;:!?])/gu, "$1")
    .replace(/,\s*([!?])/gu, "$1")
    // Se a mensagem começava pela variável, não deixa pontuação órfã.
    .replace(/(^|\n)[ \t]*[,;:][ \t]*/gu, "$1")
    .replace(/[ \t]{2,}/gu, " ")
    .replace(/^[ \t]+|[ \t]+$/gmu, "")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();

  // "[Nome], posso ajudar?" deve continuar parecendo uma frase natural.
  return cleaned.replace(/^\p{Ll}/u, (letter) => letter.toLocaleUpperCase("pt-BR"));
}
