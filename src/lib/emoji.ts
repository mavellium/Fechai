/**
 * "Encerrar conversa com emoji": o cliente manda só um emoji (com espaço em
 * volta) e o agente para de responder naquela conversa.
 *
 * `\p{Extended_Pictographic}` cobre quase todos os emojis; os componentes de
 * junção (ZWJ, variação e tecla de keycap) entram explícitos porque não são
 * pictográficos sozinhos. Aceita espaço — "👍 " é um encerramento, "👍 até
 * logo" não é.
 */
export function isEmojiOnly(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && /^[\p{Extended_Pictographic}\uFE0F\u200D\u20E3\s]+$/u.test(t);
}
