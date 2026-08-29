import { isGoogleAuthConfigured } from "@/auth";
import { errorSuggestsSignup, loginErrorMessage } from "@/modules/auth/login-errors";
import { LoginForm } from "./LoginForm";

/**
 * A tela virou Server Component só para resolver o que o cliente não pode: se o
 * provider do Google está configurado (ler env no navegador não dá) e traduzir
 * o `?error=` que o NextAuth devolve depois de um OAuth malsucedido. O
 * formulário em si continua sendo client — ele tem estado.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; reset?: string }>;
}) {
  const { error, reset } = await searchParams;

  return (
    <LoginForm
      googleEnabled={isGoogleAuthConfigured}
      initialError={loginErrorMessage(error)}
      suggestSignup={errorSuggestsSignup(error)}
      notice={reset === "1" ? "Senha alterada. Entre com ela para continuar." : null}
    />
  );
}
