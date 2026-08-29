/**
 * Envio de e-mail transacional via Resend.
 *
 * Uma função só, sem SDK: a API do Resend é um POST com JSON, e a dependência
 * extra não pagaria por si mesma. Quem chama trata `{ ok: false }` — nenhum
 * fluxo de produto deve quebrar porque o provedor de e-mail caiu.
 *
 * Em desenvolvimento sem chave configurada o e-mail vai para o console em vez
 * de falhar: dá para copiar o link de redefinição do terminal e testar o fluxo
 * inteiro sem domínio verificado. Em produção, ausência de chave é erro.
 */
const RESEND_ENDPOINT = "https://api.resend.com/emails";

export type SendMailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type SendMailResult = { ok: true } | { ok: false; error: string };

export function isMailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
}

export async function sendMail({ to, subject, html, text }: SendMailInput): Promise<SendMailResult> {
  if (!isMailConfigured()) {
    if (process.env.NODE_ENV === "production") {
      console.error("[mail] RESEND_API_KEY/MAIL_FROM ausentes em produção.");
      return { ok: false, error: "Serviço de e-mail indisponível. Tente de novo mais tarde." };
    }
    console.info(
      `\n[mail] sem RESEND_API_KEY/MAIL_FROM — e-mail NÃO enviado.\n  para: ${to}\n  assunto: ${subject}\n${text}\n`,
    );
    return { ok: true };
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject, html, text }),
      cache: "no-store",
    });

    if (!response.ok) {
      console.error("[mail] Resend respondeu", response.status, await response.text());
      return { ok: false, error: "Não foi possível enviar o e-mail agora." };
    }

    return { ok: true };
  } catch (error) {
    console.error("[mail] falha ao chamar a API de e-mail:", error);
    return { ok: false, error: "Não foi possível enviar o e-mail agora." };
  }
}
