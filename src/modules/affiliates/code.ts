import { randomInt } from "node:crypto";

/**
 * Alfabeto sem caracteres ambíguos (0/O, 1/I/L) — o código é ditado por
 * telefone e copiado de print, então confundir caractere custa uma venda.
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 7;

/** Código aleatório do link do afiliado (?ref=). `randomInt` evita viés de módulo. */
export function generateAffiliateCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/** Normaliza o que veio da URL antes de consultar o banco. */
export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().slice(0, 32);
}
