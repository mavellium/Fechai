import { prisma } from "@/lib/prisma";

/**
 * Bloqueio de IP **decidido pelo admin**.
 *
 * Existe ao lado do freio automático (`lib/login-throttle`), não no lugar dele.
 * A diferença não é de intensidade, é de natureza:
 *
 * | | freio automático | este |
 * |---|---|---|
 * | quem decide | o sistema, contando falhas | uma pessoa |
 * | onde mora | Redis (some no restart/flush) | Postgres |
 * | quanto dura | minutos, expira sozinho | o que o admin escolher |
 * | tem motivo? | não | sim, obrigatório |
 *
 * Um `FLUSHALL` no Redis apaga o freio inteiro — e é aceitável, porque ele se
 * reconstrói na próxima tentativa. Apagar um bloqueio deliberado do mesmo jeito
 * não seria: quem bloqueou não fica sabendo, e o IP volta a tentar. Daí o
 * Postgres.
 *
 * ## Alcance
 *
 * Barra a **autenticação**, não o site. Bloquear no middleware custaria uma
 * consulta em toda requisição (inclusive nas páginas públicas e nos webhooks do
 * WhatsApp e da Stripe) e arriscaria derrubar uma integração que
 * compartilhasse o IP. Quem é barrado aqui não entra na conta de ninguém, que é
 * o problema real.
 */

/** Um bloqueio ativo, já resolvido contra a data de agora. */
export type ActiveBlock = {
  ip: string;
  reason: string;
  blockedByEmail: string | null;
  /** null = até desbloquear à mão. */
  expiresAt: Date | null;
};

/**
 * O IP está barrado neste instante?
 *
 * A expiração é verificada aqui, na leitura, e não por um job que varre a
 * tabela: um bloqueio vencido que continua gravado simplesmente não barra
 * ninguém. Um cron só para apagar linhas seria trabalho sem ganho — e uma
 * janela em que o vencido ainda barra, caso o job atrase.
 *
 * **Nunca lança.** Se o banco estiver fora do ar, o login segue sem esta
 * barreira — a mesma escolha do freio automático com o Redis. Falhar fechado
 * transformaria uma indisponibilidade do banco numa impossibilidade de entrar
 * para todo mundo, inclusive para quem vai consertar.
 */
export async function isIpBlocked(ip: string): Promise<ActiveBlock | null> {
  if (!ip || ip === "desconhecido") return null;

  try {
    const block = await prisma.blockedIp.findUnique({ where: { ip } });
    if (!block) return null;
    if (block.expiresAt && block.expiresAt <= new Date()) return null;

    return {
      ip: block.ip,
      reason: block.reason,
      blockedByEmail: block.blockedByEmail,
      expiresAt: block.expiresAt,
    };
  } catch (error) {
    console.error("[ip-block] não foi possível checar o bloqueio — seguindo sem ele:", error);
    return null;
  }
}

/** Períodos oferecidos na tela. `null` = permanente. */
export const BLOCK_DURATIONS = [
  { value: "permanente", label: "Até desbloquear", hours: null },
  { value: "1h", label: "1 hora", hours: 1 },
  { value: "24h", label: "24 horas", hours: 24 },
  { value: "7d", label: "7 dias", hours: 24 * 7 },
] as const;

export type BlockDuration = (typeof BLOCK_DURATIONS)[number]["value"];

/**
 * Converte a escolha da tela em data de expiração. Valor desconhecido vira
 * permanente — nunca um bloqueio de duração acidental.
 */
export function expiresAtFor(duration: string): Date | null {
  const found = BLOCK_DURATIONS.find((d) => d.value === duration);
  if (!found?.hours) return null;
  return new Date(Date.now() + found.hours * 60 * 60 * 1000);
}

/**
 * Bloqueia (ou re-bloqueia) um IP.
 *
 * `upsert` porque bloquear duas vezes o mesmo endereço não são dois bloqueios:
 * o segundo é uma correção do primeiro (mudou o motivo, estendeu o prazo). Sem
 * isso a segunda tentativa estouraria na constraint `@unique` e a tela mostraria
 * um erro de banco para uma ação que faz todo sentido.
 */
export async function blockIp(input: {
  ip: string;
  reason: string;
  duration: string;
  actor: { id: string; email: string | null };
  lastEmail?: string | null;
  attempts?: number;
}): Promise<ActiveBlock> {
  const expiresAt = expiresAtFor(input.duration);
  const data = {
    reason: input.reason,
    blockedById: input.actor.id,
    blockedByEmail: input.actor.email,
    expiresAt,
    lastEmail: input.lastEmail ?? null,
    attemptsAtBlock: input.attempts ?? 0,
  };

  const saved = await prisma.blockedIp.upsert({
    where: { ip: input.ip },
    create: { ip: input.ip, ...data },
    update: data,
  });

  return {
    ip: saved.ip,
    reason: saved.reason,
    blockedByEmail: saved.blockedByEmail,
    expiresAt: saved.expiresAt,
  };
}

/** Solta o IP. Devolve `null` se ele não estava bloqueado. */
export async function unblockIp(ip: string): Promise<{ reason: string } | null> {
  const existing = await prisma.blockedIp.findUnique({ where: { ip } });
  if (!existing) return null;
  await prisma.blockedIp.delete({ where: { ip } });
  return { reason: existing.reason };
}

export type BlockedIpRow = {
  id: string;
  ip: string;
  reason: string;
  blockedByEmail: string | null;
  expiresAt: Date | null;
  lastEmail: string | null;
  attemptsAtBlock: number;
  createdAt: Date;
  /** Já passou da validade — continua na tabela, mas não barra mais ninguém. */
  expired: boolean;
};

/**
 * Os bloqueios, para a tela.
 *
 * Traz os vencidos junto, marcados: sumir com eles em silêncio faria o admin
 * que bloqueou por 24h achar que alguém desfez a ação dele. Vencido aparece
 * como "expirou", e o botão vira "remover da lista".
 */
export async function listBlockedIps(): Promise<BlockedIpRow[]> {
  const now = new Date();
  const rows = await prisma.blockedIp.findMany({ orderBy: { createdAt: "desc" } });
  return rows.map((row) => ({
    ...row,
    expired: Boolean(row.expiresAt && row.expiresAt <= now),
  }));
}

/** Quantos estão barrando de verdade agora — o número que a aba mostra. */
export async function countActiveBlocks(): Promise<number> {
  try {
    return await prisma.blockedIp.count({
      where: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    });
  } catch {
    return 0;
  }
}

/**
 * Os IPs bloqueados dentre uma lista — usado pela tela de logs para marcar as
 * linhas de acesso.
 *
 * Uma consulta só para a página inteira, em vez de uma por linha: a lista tem
 * 50 eventos e um `isIpBlocked` por linha seriam 50 idas ao banco para
 * desenhar uma etiqueta.
 */
export async function activeBlocksAmong(ips: string[]): Promise<Set<string>> {
  const unique = [...new Set(ips.filter(Boolean))];
  if (unique.length === 0) return new Set();

  try {
    const rows = await prisma.blockedIp.findMany({
      where: {
        ip: { in: unique },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { ip: true },
    });
    return new Set(rows.map((r) => r.ip));
  } catch (error) {
    console.error("[ip-block] não foi possível marcar os IPs bloqueados:", error);
    return new Set();
  }
}

/**
 * Retrato de um IP para o diálogo de bloqueio: o que ele andou fazendo.
 *
 * Vem de `LoginAttempt`, não do `AuditLog`: a trilha do admin só registra login
 * de conta que existe (ver `attempts.ts`), e quem varre e-mails aleatórios —
 * exatamente quem se quer bloquear — não aparece lá. O número que importa ao
 * decidir é o total de tentativas, inclusive as que não bateram em conta nenhuma.
 */
export async function ipActivity(ip: string, days = 7) {
  const since = new Date(Date.now() - days * 86_400_000);

  const [total, failures, lastAttempt, emails] = await Promise.all([
    prisma.loginAttempt.count({ where: { ip, createdAt: { gte: since } } }),
    prisma.loginAttempt.count({ where: { ip, success: false, createdAt: { gte: since } } }),
    prisma.loginAttempt.findFirst({
      where: { ip },
      orderBy: { createdAt: "desc" },
      select: { email: true, createdAt: true, success: true },
    }),
    prisma.loginAttempt.findMany({
      where: { ip, createdAt: { gte: since }, email: { not: null } },
      distinct: ["email"],
      select: { email: true },
      take: 20,
    }),
  ]);

  return {
    total,
    failures,
    lastEmail: lastAttempt?.email ?? null,
    lastAt: lastAttempt?.createdAt ?? null,
    /** Quantas contas diferentes esse IP tentou — o sinal de *spray*. */
    distinctEmails: emails.length,
    days,
  };
}
