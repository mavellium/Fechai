"use server";

import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { strongPassword } from "@/lib/password-schema";
import { clearLoginFailures } from "@/lib/login-throttle";
import { requestContext } from "@/modules/auth/attempts";
import { hashResetToken, resolveUsableResetToken } from "@/modules/auth/password-reset";

const schema = z
  .object({
    token: z.string().min(1),
    password: strongPassword(),
    confirmPassword: z.string().min(1),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "As duas senhas precisam ser iguais.",
    path: ["confirmPassword"],
  });

export type ResetPasswordState = { ok?: boolean; error?: string } | null;

const INVALID_TOKEN = "Este link não vale mais. Peça um novo em “Esqueci minha senha”.";

export async function resetPassword(
  _prev: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const parsed = schema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  // Revalidado aqui, e não só na página: entre abrir o link e enviar o
  // formulário o token pode ter expirado ou sido usado em outra aba.
  const resolved = await resolveUsableResetToken(parsed.data.token);
  if (!resolved) return { ok: false, error: INVALID_TOKEN };

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);

  /*
   * Tudo numa transação com a marcação de uso: se a senha for gravada e o token
   * continuar válido, o mesmo link redefine a senha de novo mais tarde — e ele
   * está guardado na caixa de entrada, que é justamente o que pode ter sido
   * comprometido. `updateMany` derruba junto qualquer outro link em aberto.
   */
  await prisma.$transaction([
    prisma.user.update({
      where: { id: resolved.userId },
      data: { passwordHash },
    }),
    prisma.passwordResetToken.update({
      where: { tokenHash: hashResetToken(parsed.data.token) },
      data: { usedAt: new Date() },
    }),
    prisma.passwordResetToken.updateMany({
      where: { userId: resolved.userId, usedAt: null },
      data: { usedAt: new Date() },
    }),
  ]);

  // Quem chegou aqui provavelmente errou a senha várias vezes e está bloqueado.
  // Manter o bloqueio depois da redefinição faria a pessoa não conseguir entrar
  // com a senha que acabou de criar.
  const { ip } = await requestContext();
  await clearLoginFailures(resolved.email, ip);

  return { ok: true };
}
