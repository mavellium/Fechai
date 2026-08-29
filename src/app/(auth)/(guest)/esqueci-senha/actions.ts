"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { appBaseUrl } from "@/lib/app-url";
import { sendMail } from "@/lib/mail";
import { formatWait, rateLimit } from "@/lib/rate-limit";
import { requestContext } from "@/modules/auth/attempts";
import { issueResetToken } from "@/modules/auth/password-reset";
import { buildPasswordResetEmail } from "@/modules/auth/reset-email";

const schema = z.object({ email: z.string().email() });

/**
 * A MESMA resposta para e-mail cadastrado e não cadastrado. Dizer "não achamos
 * essa conta" transformaria esta tela, que é pública e sem senha, num verificador
 * de quem é cliente do fechai — exatamente a lista que alguém precisa antes de
 * tentar força bruta ou phishing.
 */
const GENERIC_MESSAGE =
  "Se existir uma conta com esse e-mail, o link para criar uma nova senha já está a caminho.";

export type ForgotPasswordState = {
  ok?: boolean;
  /** E-mail informado, para a tela de confirmação e o botão de reenviar. */
  email?: string;
  message?: string;
  error?: string;
};

export async function requestPasswordReset(
  _prev: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const parsed = schema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { ok: false, error: "Informe um e-mail válido." };
  }

  const email = parsed.data.email.trim().toLowerCase();
  const context = await requestContext();

  // Dois limites: por IP (impede varrer muitos e-mails da mesma origem) e por
  // e-mail (impede usar o formulário para encher a caixa de entrada de alguém).
  const [byIp, byEmail] = await Promise.all([
    rateLimit("reset:ip", context.ip, 5, 15 * 60),
    rateLimit("reset:email", email, 3, 15 * 60),
  ]);

  if (!byIp.allowed || !byEmail.allowed) {
    const wait = Math.max(byIp.retryAfterSeconds, byEmail.retryAfterSeconds);
    return {
      ok: false,
      email,
      error: `Já foram vários pedidos seguidos. Tente de novo em ${formatWait(wait)}.`,
    };
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true },
  });

  // Sem conta: sai por aqui com a mesma mensagem de sucesso. O tempo de resposta
  // difere um pouco (não mandamos e-mail), mas isso não é observável de fora com
  // confiança — e o custo de esconder seria enfileirar um envio falso.
  if (!user) return { ok: true, email, message: GENERIC_MESSAGE };

  const token = await issueResetToken({
    userId: user.id,
    ip: context.ip,
    userAgent: context.userAgent,
  });

  const baseUrl = await appBaseUrl();
  const mail = buildPasswordResetEmail({
    name: user.name,
    resetUrl: `${baseUrl}/redefinir-senha/${token}`,
  });

  const sent = await sendMail({ to: user.email, ...mail });
  if (!sent.ok) {
    // Aqui a mensagem é específica de propósito: o problema é nosso, não da
    // pessoa, e ela precisa saber que tentar de novo faz sentido.
    return { ok: false, email, error: sent.error };
  }

  return { ok: true, email, message: GENERIC_MESSAGE };
}
