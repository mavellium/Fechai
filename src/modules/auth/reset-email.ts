import { PASSWORD_RESET_TTL_MINUTES } from "./password-reset";

/**
 * O e-mail de redefinição de senha, em HTML e texto puro.
 *
 * Tabela e estilo inline não é preguiça: Gmail, Outlook e Apple Mail descartam
 * `<style>` externo e flexbox. Fontes da marca também não sobrevivem ao cliente
 * de e-mail, então a pilha cai para as do sistema — as cores é que carregam a
 * identidade aqui.
 *
 * A versão em texto existe para o cliente que bloqueia HTML e para não parecer
 * spam: e-mail só-HTML pontua pior em filtro.
 */
const INK = "#14171f";
const IRIS = "#4b3cf0";
const PAPER = "#f7f8fb";
const NEUTRAL = "#6b7280";

export function buildPasswordResetEmail({
  name,
  resetUrl,
}: {
  name: string | null;
  resetUrl: string;
}) {
  const greeting = name?.trim() ? `Olá, ${name.trim()}` : "Olá";

  const text = [
    `${greeting},`,
    "",
    "Recebemos um pedido para redefinir a senha da sua conta no fechai.",
    `Abra o link abaixo para criar uma nova senha. Ele vale por ${PASSWORD_RESET_TTL_MINUTES} minutos e só pode ser usado uma vez:`,
    "",
    resetUrl,
    "",
    "Se não foi você que pediu, ignore este e-mail — sua senha atual continua valendo e ninguém tem acesso à sua conta.",
    "",
    "— fechai",
  ].join("\n");

  const html = `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:24px;background:${PAPER};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${INK}">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid rgba(20,23,31,0.08)">
      <tr>
        <td style="padding:32px">
          <p style="margin:0 0 24px;font-size:20px;font-weight:700;letter-spacing:-0.01em;color:${INK}">fechai<span style="color:#ff6b4a">.</span></p>

          <p style="margin:0 0 16px;font-size:16px;font-weight:600;color:${INK}">${greeting},</p>

          <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${INK}">
            Recebemos um pedido para redefinir a senha da sua conta no <strong>fechai</strong>.
          </p>

          <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:${INK}">
            O link abaixo vale por <strong>${PASSWORD_RESET_TTL_MINUTES} minutos</strong> e só pode ser usado uma vez.
          </p>

          <p style="margin:0 0 24px">
            <a href="${resetUrl}" style="display:inline-block;background:${IRIS};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:600">Criar nova senha</a>
          </p>

          <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:${NEUTRAL}">
            Se o botão não abrir, copie e cole este endereço no navegador:
          </p>
          <p style="margin:0 0 24px;font-size:13px;line-height:1.6;color:${NEUTRAL};word-break:break-all">${resetUrl}</p>

          <p style="margin:0;padding-top:24px;border-top:1px solid rgba(20,23,31,0.08);font-size:13px;line-height:1.6;color:${NEUTRAL}">
            Não foi você que pediu? Ignore este e-mail. Sua senha atual continua valendo e ninguém entrou na sua conta.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject: "Redefinir sua senha — fechai", html, text };
}
