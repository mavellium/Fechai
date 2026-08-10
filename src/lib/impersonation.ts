import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Personificação: o superadmin "entra" como um usuário/cliente e vê o painel
 * como ele. O estado vive num cookie curto, assinado com AUTH_SECRET — só quem
 * tem o secret pode criar um token válido, e a criação acontece apenas numa
 * Server Action protegida por requireSuperadmin(). A sessão JWT em si nunca é
 * trocada; os guards (src/lib/session.ts) consultam este cookie e sobrepõem o
 * tenantId/role para quem é SUPERADMIN de verdade.
 */

const COOKIE_NAME = "fechai_impersonation";
const COOKIE_TTL_SECONDS = 30 * 60;

export type Impersonation = {
  userId: string;
  email: string;
  role: string;
  tenantId: string;
};

function hmac(value: string) {
  return createHmac("sha256", process.env.AUTH_SECRET ?? "").update(value).digest("hex");
}

function encode(payload: Impersonation) {
  const raw = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${raw}.${hmac(raw)}`;
}

function decode(value: string): Impersonation | null {
  const [raw, sig] = value.split(".");
  if (!raw || !sig) return null;
  const expected = Buffer.from(hmac(raw), "hex");
  const actual = Buffer.from(sig, "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    return JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Impersonation;
  } catch {
    return null;
  }
}

export async function setImpersonation(data: Impersonation) {
  (await cookies()).set(COOKIE_NAME, encode(data), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_TTL_SECONDS,
  });
}

export async function clearImpersonation() {
  (await cookies()).delete(COOKIE_NAME);
}

export async function getImpersonation(): Promise<Impersonation | null> {
  const value = (await cookies()).get(COOKIE_NAME)?.value;
  if (!value) return null;
  return decode(value);
}
