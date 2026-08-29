import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import {
  PASSWORD_RESET_TTL_MINUTES,
  resolveUsableResetToken,
} from "@/modules/auth/password-reset";
import { ResetPasswordForm } from "../ResetPasswordForm";

export const metadata: Metadata = {
  title: "Criar nova senha",
  robots: { index: false, follow: false },
};

/**
 * O token vem no caminho (e não em `?token=`) para não vazar em `Referer` nem
 * em log de proxy, que costuma guardar a query string inteira.
 */
export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const resolved = await resolveUsableResetToken(token);

  // Link inválido, expirado ou já usado dão a MESMA tela: separar os casos
  // contaria a quem está testando tokens no chute qual deles chegou perto.
  if (!resolved) {
    return (
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">Este link não vale mais</h1>
        <p className="mt-1 text-sm leading-relaxed text-neutral">
          Links de redefinição valem por {PASSWORD_RESET_TTL_MINUTES} minutos e só funcionam uma
          vez. Se o seu expirou ou já foi usado, peça outro — leva alguns segundos.
        </p>

        <Alert tone="info" className="mt-6">
          Se não foi você que pediu a redefinição, pode ignorar: sua senha atual continua valendo.
        </Alert>

        <ButtonLink href="/esqueci-senha" variant="cta" className="mt-6 w-full">
          Pedir um novo link
        </ButtonLink>

        <p className="mt-6 text-center text-sm text-neutral">
          <Link href="/login" className="font-medium text-iris hover:underline">
            Voltar para o login
          </Link>
        </p>
      </div>
    );
  }

  return <ResetPasswordForm token={token} email={resolved.email} />;
}
