/**
 * O que NUNCA entra num snapshot de auditoria.
 *
 * O log guarda o estado de um registro para poder reverter, e um registro
 * carrega coisas que não podem ficar em claro numa tabela que o painel do
 * admin lê e exibe: hash de senha, token de reset, credencial cifrada de
 * terceiro (que sai cifrada do banco, mas não tem por que ser copiada), chave
 * de API. Guardar isso no log significaria que vazar a trilha de auditoria
 * vaza também tudo que ela auditou.
 *
 * A lista é por NOME DE CAMPO e vale em qualquer profundidade do objeto:
 * `recordChange` recebe objetos do Prisma direto das actions, e depender de
 * cada chamador lembrar de tirar o campo certo é o tipo de disciplina que
 * falha na primeira action nova.
 */

/**
 * Campos removidos do snapshot, comparados em minúsculas.
 *
 * A lista exata não é suficiente sozinha — `apiToken`, `apiUser`,
 * `refreshTokenEnc` e afins nascem a cada integração nova, e uma lista fechada
 * envelhece em silêncio (o campo novo passa direto e ninguém percebe até
 * alguém ler o log). Por isso, além dela, vale a checagem por SUFIXO/prefixo
 * em `isSecretField`: qualquer campo que termine em "token", "secret", "key",
 * "password" ou "hash" é redigido, mesmo sem estar aqui.
 */
const SECRET_FIELDS = new Set([
  "passwordhash",
  "password",
  "temppassword",
  "token",
  "tokenhash",
  "accesstoken",
  "refreshtoken",
  "apikey",
  "apiuser",
  "secret",
  "secretenc",
  "clientsecret",
  "clientid",
  "privatekey",
  "credentials",
  "authorization",
  "embedding",
]);

/**
 * Sufixos que denunciam um segredo, qualquer que seja o prefixo. É o que faz
 * `apiToken`, `googleRefreshToken` e `webhookSecret` serem cortados sem que
 * alguém tenha de lembrar de adicioná-los à lista acima.
 */
const SECRET_SUFFIXES = ["token", "secret", "password", "passwordhash", "apikey", "privatekey"];

function isSecretField(key: string): boolean {
  const name = key.toLowerCase();
  if (SECRET_FIELDS.has(name)) return true;
  return SECRET_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

/**
 * Campos cujo valor é grande demais para caber num log útil (texto integral de
 * documento, vetor de embedding). Ficam como um resumo: a auditoria precisa
 * saber QUE o texto mudou e qual era o tamanho, não repetir 40 KB de PDF em
 * cada linha da tabela.
 *
 * Consequência aceita: um documento restaurado por `revert` volta sem o
 * conteúdo integral quando ele passou do teto — a tela avisa antes de
 * confirmar, em vez de restaurar um documento vazio em silêncio.
 */
const MAX_STRING_LENGTH = 4_000;

export const REDACTED = "[oculto]" as const;

/** Marca deixada no lugar de um texto cortado, para a tela poder avisar. */
export type TruncatedValue = { __truncated: true; length: number; preview: string };

export function isTruncated(value: unknown): value is TruncatedValue {
  return typeof value === "object" && value !== null && "__truncated" in value;
}

/**
 * Devolve uma cópia segura para gravar. Não muta o objeto recebido — ele é o
 * registro que a action ainda vai usar.
 */
export function redactSnapshot<T>(value: T): unknown {
  return walk(value, 0);
}

function walk(value: unknown, depth: number): unknown {
  // Profundidade máxima: um objeto do Prisma com includes aninhados poderia
  // arrastar a conta inteira para dentro de uma linha de log.
  if (depth > 6) return "[profundo demais]";

  if (value === null || value === undefined) return value ?? null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();

  if (typeof value === "string") {
    if (value.length <= MAX_STRING_LENGTH) return value;
    return {
      __truncated: true,
      length: value.length,
      preview: value.slice(0, 240),
    } satisfies TruncatedValue;
  }

  if (typeof value !== "object") return value;

  if (Array.isArray(value)) {
    // Listas longas (chunks, mensagens) viram contagem: reverter nunca usa o
    // conteúdo de uma coleção, e guardá-la explodiria a linha.
    if (value.length > 50) return `[${value.length} itens]`;
    return value.map((item) => walk(item, depth + 1));
  }

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSecretField(key) ? REDACTED : walk(val, depth + 1);
  }
  return out;
}

/** Um campo redigido não pode ser regravado num revert — só sobrescreveria o
 *  segredo real com a string "[oculto]". `revert.ts` usa isto para recusar. */
export function containsRedacted(value: unknown): boolean {
  if (value === REDACTED) return true;
  if (Array.isArray(value)) return value.some(containsRedacted);
  if (typeof value === "object" && value !== null) {
    return Object.values(value as Record<string, unknown>).some(containsRedacted);
  }
  return false;
}
