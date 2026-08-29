import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";

/**
 * Regras do "esqueci minha senha".
 *
 * O que vai no link é um segredo aleatório de 256 bits; o banco guarda só o
 * SHA-256 dele. Assim um vazamento da tabela não dá a ninguém o poder de
 * redefinir senhas — o token em claro só existiu no e-mail do dono da conta.
 * Não há salt nem bcrypt aqui de propósito: o token já é aleatório e de alta
 * entropia, então não existe dicionário para atacar, e SHA-256 permite buscar
 * o registro por índice único em vez de varrer a tabela inteira comparando.
 */

/** Curto porque o link é uma chave de conta viajando por e-mail. */
export const PASSWORD_RESET_TTL_MINUTES = 30;

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createResetToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashResetToken(token) };
}

export function resetTokenExpiresAt(from: Date = new Date()): Date {
  return new Date(from.getTime() + PASSWORD_RESET_TTL_MINUTES * 60_000);
}

export type ResolvedResetToken = {
  id: string;
  userId: string;
  email: string;
};

/**
 * Devolve o token só quando ele serve para redefinir agora: existe, não foi
 * usado, não expirou e o dono ainda existe. Qualquer "não" vira `null` — a tela
 * mostra a mesma mensagem para todos os casos, porque distinguir "expirado" de
 * "inexistente" só ajudaria quem está testando tokens no chute.
 */
export async function resolveUsableResetToken(
  token: string,
): Promise<ResolvedResetToken | null> {
  if (!token) return null;

  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashResetToken(token) },
    select: {
      id: true,
      usedAt: true,
      expiresAt: true,
      user: { select: { id: true, email: true } },
    },
  });

  if (!record || record.usedAt !== null || record.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  return { id: record.id, userId: record.user.id, email: record.user.email };
}

/**
 * Emitir um link novo derruba os anteriores. Sem isso, cada pedido deixaria
 * mais uma chave válida circulando na caixa de entrada da pessoa.
 */
export async function issueResetToken(input: {
  userId: string;
  ip: string;
  userAgent: string | null;
}): Promise<string> {
  const { token, tokenHash } = createResetToken();

  await prisma.$transaction([
    prisma.passwordResetToken.updateMany({
      where: { userId: input.userId, usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.passwordResetToken.create({
      data: {
        userId: input.userId,
        tokenHash,
        expiresAt: resetTokenExpiresAt(),
        ip: input.ip,
        userAgent: input.userAgent,
      },
    }),
  ]);

  return token;
}
