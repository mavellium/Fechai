/**
 * Tradução dos códigos de erro que chegam em `/login?error=`.
 *
 * Parte vem do NextAuth (OAuthSignin, AccessDenied…), parte é nossa, devolvida
 * pelo callback `signIn` do Google. Uma mensagem em inglês vazando na tela é
 * pior do que um erro genérico: a pessoa não sabe o que fazer com "AccessDenied".
 *
 * Toda mensagem termina dizendo o próximo passo — erro sem saída deixa a pessoa
 * presa na tela de login.
 */
const MESSAGES: Record<string, string> = {
  google_no_account:
    "Nenhuma conta do fechai usa esse e-mail do Google. Crie sua conta primeiro — leva menos de um minuto.",
  google_unverified:
    "O Google não confirmou esse endereço de e-mail. Entre com e-mail e senha.",
  OAuthAccountNotLinked:
    "Esse e-mail já entra por outro caminho. Use e-mail e senha para acessar.",
  OAuthSignin: "Não deu para iniciar o login com o Google. Tente de novo.",
  OAuthCallback: "O Google não concluiu o login. Tente de novo.",
  OAuthCallbackError: "O Google não concluiu o login. Tente de novo.",
  AccessDenied: "Você cancelou a permissão no Google, então não entramos na conta.",
  Configuration:
    "Login com Google indisponível: falta configuração no servidor. Use e-mail e senha.",
  Verification: "Esse link já foi usado ou expirou. Peça um novo.",
};

export function loginErrorMessage(code?: string | null): string | null {
  if (!code) return null;
  return MESSAGES[code] ?? "Não foi possível concluir o login. Tente de novo.";
}

/** O erro do Google que tem como próximo passo o cadastro, não o suporte. */
export function errorSuggestsSignup(code?: string | null): boolean {
  return code === "google_no_account";
}
