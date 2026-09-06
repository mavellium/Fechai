"use server";

import { signIn } from "@/auth";
import { formatRetryAfter, peekLoginBlock } from "@/lib/login-throttle";
import { requestContext } from "@/modules/auth/attempts";
import { isIpBlocked } from "@/modules/auth/ip-block";

/**
 * Manda para o consentimento do Google. É Server Action (e não `signIn` do
 * `next-auth/react`) porque o redirecionamento do OAuth precisa acontecer no
 * servidor: no cliente ele viraria um fetch que o navegador não segue.
 *
 * `/inicio` serve para os dois papéis — o layout do painel já manda o
 * superadmin para `/admin/contas`.
 */
export async function startGoogleSignIn() {
  await signIn("google", { redirectTo: "/inicio" });
}

export type LoginBlockStatus = {
  blocked: boolean;
  /** Mensagem pronta para a tela; null quando não há nada a dizer. */
  message: string | null;
};

/**
 * Estado do freio de tentativas para o e-mail digitado, sem consumir nada.
 *
 * A tela precisa disto porque o NextAuth devolve um erro genérico ao cliente
 * de propósito — sem esta consulta, quem foi bloqueado veria "e-mail ou senha
 * não conferem" para sempre e ficaria tentando a senha certa achando que
 * esqueceu. Não vaza informação: o contador é do par e-mail+IP de quem está
 * perguntando, ou seja, dados que a própria pessoa gerou.
 */
export async function loginBlockStatus(email: string): Promise<LoginBlockStatus> {
  if (!email.includes("@")) return { blocked: false, message: null };

  const { ip } = await requestContext();

  // O bloqueio do admin é checado primeiro e responde diferente: ele não passa
  // com o tempo. Mostrar "espere 5 minutos" a quem está bloqueado de verdade
  // manda a pessoa esperar por algo que nunca vai acontecer — e faz o suporte
  // receber a ligação cinco minutos depois em vez de agora.
  if (await isIpBlocked(ip)) {
    return {
      blocked: true,
      message: "Este acesso está bloqueado. Se você acha que é um engano, fale com o suporte.",
    };
  }

  const block = await peekLoginBlock(email, ip);

  if (block.blocked) {
    return {
      blocked: true,
      message: `Muitas tentativas seguidas nesta conta. Espere ${formatRetryAfter(
        block.retryAfterSeconds,
      )} e tente de novo — ou redefina sua senha agora.`,
    };
  }

  // Avisar antes de travar: quem esqueceu a senha tem a chance de parar e usar
  // o "Esqueci minha senha" em vez de descobrir o bloqueio quando já é tarde.
  if (block.failures >= 3) {
    return {
      blocked: false,
      message:
        "Já são várias tentativas sem sucesso. Depois da próxima, o acesso a esta conta fica bloqueado por alguns minutos.",
    };
  }

  return { blocked: false, message: null };
}
