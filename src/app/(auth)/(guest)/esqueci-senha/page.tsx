import type { Metadata } from "next";
import { PASSWORD_RESET_TTL_MINUTES } from "@/modules/auth/password-reset";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

/**
 * Fora do índice: diferente de /login e /cadastro, esta tela não é destino de
 * busca (ninguém procura "esqueci senha fechai" no Google antes de ter conta) e
 * indexá-la só espalharia um formulário de disparo de e-mail.
 */
export const metadata: Metadata = {
  title: "Recuperar acesso",
  description: "Receba um link para criar uma nova senha da sua conta no fechai.",
  alternates: { canonical: "/esqueci-senha" },
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm ttlMinutes={PASSWORD_RESET_TTL_MINUTES} />;
}
