/**
 * Cidade dita pelo contato: limpeza para exibição e chave para comparar.
 *
 * O contato escreve "Marília", "marilia sp", "Marília - SP", "MARÍLIA/SP". A
 * chave tira acento, caixa e a UF que vem colada, para os quatro serem o mesmo.
 * Puro — o painel, o relatório e os testes importam daqui.
 */

const UFS = new Set([
  "ac", "al", "ap", "am", "ba", "ce", "df", "es", "go", "ma", "mt", "ms", "mg",
  "pa", "pb", "pr", "pe", "pi", "rj", "rn", "rs", "ro", "rr", "sc", "sp", "se", "to",
]);

const MAX_CITY = 60;

function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Texto de cidade para exibir, ou null se o valor não parece uma cidade (vazio,
 * comprido demais, com número ou símbolo de link/e-mail). O agente às vezes
 * manda a frase inteira ("moro em Marília e queria saber…"): melhor descartar
 * do que gravar lixo no ranking.
 */
export function cleanCity(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text || text.length > MAX_CITY) return null;
  if (/[\d@/\\:;<>{}[\]()=+*_#%$&!?]/.test(text.replace(/\/([a-z]{2})$/i, ""))) return null;
  if (text.split(" ").length > 6) return null;
  return text;
}

/**
 * Chave de comparação: minúsculas, sem acento, sem pontuação e sem a UF final
 * ("Marília - SP", "Marília/SP", "marilia sp" → "marilia"). Nenhuma cidade
 * brasileira termina em uma sigla de estado solta, então tirar o último termo
 * quando é UF é seguro — desde que sobre um nome (3+ letras).
 */
export function normalizeCity(raw: unknown): string | null {
  const cleaned = cleanCity(raw);
  if (!cleaned) return null;
  const words = stripAccents(cleaned)
    .toLowerCase()
    .replace(/[^a-z' ]+/g, " ")
    .replace(/'/g, "")
    .split(/\s+/)
    .filter(Boolean);
  const last = words[words.length - 1];
  if (words.length > 1 && last && UFS.has(last) && words.slice(0, -1).join(" ").length >= 3) words.pop();
  return words.join(" ") || null;
}

/** Distância de edição limitada a 1 (troca, falta ou sobra de uma letra). */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i);
}

/**
 * Duas chaves são a mesma cidade? Igual, ou a um erro de digitação de distância
 * ("marilha"), mas só em nomes de 6+ letras — em nome curto uma letra a mais
 * separa cidades diferentes (Tupã, Tupi).
 */
export function sameCity(a: string, b: string): boolean {
  if (a === b) return true;
  return a.length >= 6 && b.length >= 6 && withinOneEdit(a, b);
}
