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
  /**
   * Instante de expiração, DENTRO do payload assinado. O `maxAge` do cookie
   * não serve para isso: ele é uma instrução ao navegador, e quem captura o
   * cookie simplesmente não a obedece — sem este campo, um cookie de
   * personificação vazado valeria para sempre.
   */
  exp?: number;
};

/**
 * Segredo de assinatura. Antes era `process.env.AUTH_SECRET ?? ""`, e o fallback
 * era o problema: sem a variável, o HMAC passava a usar chave vazia — conhecida
 * por qualquer um — e a verificação continuava "passando", sem nenhum sinal de
 * que a proteção havia sumido. Como o NextAuth v5 aceita tanto `AUTH_SECRET`
 * quanto `NEXTAUTH_SECRET`, uma instalação com só a segunda logava normalmente
 * enquanto a personificação ficava forjável.
 *
 * Agora lança, como em `lib/crypto`: falhar alto na hora é melhor que degradar
 * em silêncio numa função de autorização.
 */
function secret(): string {
  const value = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!value || value.length < 32) {
    throw new Error(
      "AUTH_SECRET ausente ou curta demais (mínimo 32 caracteres) — " +
        "personificação desabilitada. Gere uma com: openssl rand -base64 32",
    );
  }
  return value;
}

function hmac(value: string) {
  return createHmac("sha256", secret()).update(value).digest("hex");
}

function encode(payload: Impersonation) {
  const raw = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${raw}.${hmac(raw)}`;
}

function decode(value: string): Impersonation | null {
  const [raw, sig] = value.split(".");
  if (!raw || !sig) return null;

  let expected: Buffer;
  try {
    expected = Buffer.from(hmac(raw), "hex");
  } catch {
    // Segredo mal configurado: nenhum cookie é válido. Não derruba a página —
    // quem chama trata como "não está personificando".
    return null;
  }

  const actual = Buffer.from(sig, "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  try {
    const payload = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Impersonation;
    // Assinatura boa, prazo vencido: recusa. Cookie antigo sem `exp` também sai
    // de circulação, em vez de virar uma exceção permanente à regra.
    if (typeof payload.exp !== "number" || payload.exp <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function setImpersonation(data: Impersonation) {
  // O prazo entra no payload assinado e no cookie: o primeiro é o que vale,
  // o segundo só evita que o navegador guarde lixo já vencido.
  const payload: Impersonation = { ...data, exp: Date.now() + COOKIE_TTL_SECONDS * 1000 };
  (await cookies()).set(COOKIE_NAME, encode(payload), {
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
