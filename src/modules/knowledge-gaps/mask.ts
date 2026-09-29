/**
 * Máscara de dados do paciente para quem NÃO é da clínica (LGPD): a
 * Mavellium no painel do admin e o superadmin personificando a conta.
 *
 * A fila precisa mostrar o contexto da pergunta, não quem perguntou. Nome e
 * telefone saem dos campos do contato E de dentro do texto (a pessoa escreve
 * "sou a Maria, meu número é..." no meio da conversa). Puro, para ser testado
 * sem banco.
 */

export const HIDDEN_NAME = "[nome oculto]";
export const HIDDEN_NUMBER = "[número oculto]";
export const HIDDEN_EMAIL = "[e-mail oculto]";

/** "Luciane Aparecida" → "L. A." — dá para distinguir dois contatos na lista sem identificar ninguém. */
export function maskName(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "Contato";
  return parts.slice(0, 3).map((p) => `${p[0]!.toLocaleUpperCase("pt-BR")}.`).join(" ");
}

/** Só os dois últimos dígitos: "+•• •• •••••-••63". */
export function maskPhone(phone: string | null | undefined): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 4) return "número oculto";
  return `+•• •• •••••-••${digits.slice(-2)}`;
}

function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Tira do texto: e-mails, qualquer sequência longa de dígitos (telefone, CPF,
 * carteirinha) e as partes do nome do contato. Partes com menos de 3 letras
 * ficam ("de", "da") — sozinhas não identificam e apagá-las destruiria o texto.
 */
export function maskText(text: string, known: { names?: (string | null | undefined)[]; phones?: (string | null | undefined)[] } = {}): string {
  // NFC antes de tudo: a busca sem acento abaixo conta posições, e só com o
  // texto composto a versão sem acento tem o mesmo comprimento da original.
  let out = text.normalize("NFC").replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, HIDDEN_EMAIL);
  // 8+ dígitos com separadores comuns no meio: (14) 99763-1563, 123.456.789-00.
  out = out.replace(/\+?\d[\d\s().-]{6,}\d/g, (match) => (match.replace(/\D/g, "").length >= 8 ? HIDDEN_NUMBER : match));

  for (const phone of known.phones ?? []) {
    const digits = (phone ?? "").replace(/\D/g, "");
    if (digits.length >= 8) out = out.split(digits).join(HIDDEN_NUMBER);
  }

  const parts = new Set<string>();
  for (const name of known.names ?? []) {
    for (const part of (name ?? "").split(/\s+/)) {
      const clean = stripAccents(part.replace(/[^\p{L}]/gu, "")).toLowerCase();
      if (clean.length >= 3) parts.add(clean);
    }
  }
  if (!parts.size) return out;

  // Compara sem acento para "Luciane" pegar "luciane" e "Lúciane"; troca no
  // texto original, palavra inteira, para "Ana" não comer "banana".
  const folded = stripAccents(out);
  const pattern = new RegExp(`(?<![\\p{L}])(${[...parts].map(escapeRegExp).join("|")})(?![\\p{L}])`, "giu");
  let result = "";
  let last = 0;
  for (const match of folded.matchAll(pattern)) {
    const start = match.index ?? 0;
    result += out.slice(last, start) + HIDDEN_NAME;
    last = start + match[0].length;
  }
  return result + out.slice(last);
}
