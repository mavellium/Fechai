import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";

/**
 * Contexto da requisição de login e a trilha de auditoria de tentativas.
 *
 * Separado de `lib/login-throttle` de propósito: aquele decide *se pode
 * tentar*, este só registra *o que aconteceu*. Misturar os dois faria a
 * auditoria depender do Redis e o bloqueio depender do Postgres.
 */

export type RequestContext = { ip: string; userAgent: string | null };

/**
 * Atrás do proxy o IP real é o primeiro item de `x-forwarded-for` — o
 * `request.ip` seria o do proxy, igual para todo mundo, o que anularia
 * qualquer contagem por IP.
 */
export async function requestContext(): Promise<RequestContext> {
  const headersList = await headers();
  const forwarded = headersList.get("x-forwarded-for");
  const ip =
    forwarded?.split(",")[0]?.trim() || headersList.get("x-real-ip") || "desconhecido";
  return { ip, userAgent: headersList.get("user-agent") };
}

export type AttemptReason =
  | "bad_password"
  | "no_account"
  | "invalid_payload"
  | "blocked"
  | "google_unverified"
  | "google_no_account"
  | "google_no_password_account";

/**
 * Best-effort: uma falha ao gravar a auditoria não pode impedir alguém de
 * entrar (nem, pior, mascarar o motivo real de um erro de login).
 */
export async function recordLoginAttempt(input: {
  context: RequestContext;
  email: string | null;
  success: boolean;
  provider: "credentials" | "google";
  reason?: AttemptReason;
}): Promise<void> {
  try {
    await prisma.loginAttempt.create({
      data: {
        ip: input.context.ip,
        userAgent: input.context.userAgent,
        email: input.email?.toLowerCase() || null,
        success: input.success,
        provider: input.provider,
        reason: input.reason ?? null,
      },
    });
  } catch (error) {
    console.error("[auth] não foi possível registrar a tentativa de login:", error);
  }
}
