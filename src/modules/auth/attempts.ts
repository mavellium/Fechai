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
  /** Freio automático de força bruta (Redis, temporário). */
  | "blocked"
  /** Bloqueio deliberado do admin (Postgres, `BlockedIp`) — motivo distinto de
   *  `blocked` de propósito: são mecanismos diferentes, e confundi-los na
   *  auditoria esconderia se a barreira foi automática ou uma decisão humana. */
  | "ip_blocked"
  | "google_unverified"
  | "google_no_account"
  | "google_no_password_account";

/**
 * Best-effort: uma falha ao gravar a auditoria não pode impedir alguém de
 * entrar (nem, pior, mascarar o motivo real de um erro de login).
 *
 * Grava em DUAS tabelas, de propósito. `LoginAttempt` é a trilha completa de
 * tentativas — inclui as falhas, tem volume alto e serve à pergunta de
 * segurança ("quem tentou entrar nessa conta na terça?"). `AuditLog` recebe o
 * mesmo evento porque a linha do tempo que o admin lê em /admin/logs precisa
 * do login junto do resto: um log que mostra "trocou o plano" mas não mostra
 * "entrou" obriga a cruzar duas telas à mão para reconstruir o que aconteceu.
 *
 * O eco é feito aqui, e não nos dois pontos de chamada em `auth.ts`, para não
 * depender de cada caminho novo de login lembrar de chamar os dois.
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

  await echoToAuditLog(input);
}

/**
 * Espelha a tentativa na trilha de auditoria, resolvendo a conta pelo e-mail.
 *
 * Import dinâmico: `modules/audit/log` importa `@/auth` para descobrir quem é
 * o ator, e `auth.ts` importa este arquivo — em estático isso é um ciclo que
 * quebra a inicialização do NextAuth. Aqui o ator é sempre a pessoa que está
 * tentando entrar (ainda não há sessão), então passamos explícito e o ciclo
 * nem chega a ser exercido.
 */
async function echoToAuditLog(input: {
  context: RequestContext;
  email: string | null;
  success: boolean;
  provider: "credentials" | "google";
  reason?: AttemptReason;
}): Promise<void> {
  try {
    const email = input.email?.toLowerCase() || null;

    // Falha sem conta conhecida não vira linha na trilha do admin: seriam
    // milhares de eventos de bot tentando e-mails aleatórios, afogando o que
    // interessa. Isso continua em `LoginAttempt`, que é onde se investiga
    // ataque — a trilha do admin é sobre contas reais.
    const user = email
      ? await prisma.user.findUnique({
          where: { email },
          select: { id: true, email: true, role: true, tenantId: true },
        })
      : null;
    if (!user) return;

    const { recordAudit } = await import("@/modules/audit/log");
    await recordAudit({
      event: input.success ? "auth.login" : "auth.login_failed",
      target: { type: "User", id: user.id, label: user.email },
      meta: {
        provedor: input.provider,
        ...(input.reason ? { motivo: input.reason } : {}),
      },
      tenantId: user.tenantId,
      actor: { id: user.id, email: user.email, role: user.role },
    });
  } catch (error) {
    console.error("[auth] não foi possível espelhar o login na auditoria:", error);
  }
}
