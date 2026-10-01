import { createHmac, timingSafeEqual } from "node:crypto";

/*
 * Token curto que abre a rota de impressão do relatório mensal. Quem imprime é
 * o Chromium do servidor, que não tem a sessão de quem pediu o PDF: a rota de
 * PDF confere a sessão, assina este token e o navegador headless abre a página
 * com ele. Vale poucos minutos e só para aquela conta e competência.
 */

export type PrintGrant = { tenantId: string; month: string; /** Admin pode imprimir rascunho; o cliente, só o fechado. */ draft: boolean; exp: number };
const TTL_MS = 5 * 60 * 1000;

// Lança sem segredo, como `lib/impersonation`: HMAC com chave vazia seria forjável.
function secret(): string {
  const value = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!value || value.length < 32) throw new Error("AUTH_SECRET ausente ou curta demais: impressão do relatório desabilitada.");
  return value;
}
const sign = (raw: string) => createHmac("sha256", secret()).update(`print:${raw}`).digest("hex");

export function signPrintToken(grant: Omit<PrintGrant, "exp">, now = Date.now()): string {
  const raw = Buffer.from(JSON.stringify({ ...grant, exp: now + TTL_MS }), "utf8").toString("base64url");
  return `${raw}.${sign(raw)}`;
}

/** Null para token ausente, adulterado ou vencido. Nunca lança. */
export function verifyPrintToken(token: string | undefined, now = Date.now()): PrintGrant | null {
  const [raw, sig] = (token ?? "").split(".");
  if (!raw || !sig) return null;
  try {
    const expected = Buffer.from(sign(raw), "hex"), actual = Buffer.from(sig, "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    const grant = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as PrintGrant;
    if (typeof grant.tenantId !== "string" || typeof grant.month !== "string" || typeof grant.exp !== "number" || grant.exp < now) return null;
    return { tenantId: grant.tenantId, month: grant.month, draft: grant.draft === true, exp: grant.exp };
  } catch {
    return null;
  }
}
