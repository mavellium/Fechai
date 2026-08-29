import { z } from "zod";
import { isStrongPassword, firstPasswordIssue } from "./password";

/**
 * A política de senha forte como schema Zod, para as três entradas que criam
 * senha: `/api/register`, a troca em `/configuracoes` e a criação de conta
 * pelo admin. Fica separado de `lib/password` porque aquele módulo é importado
 * por componentes client (a checklist de força) e não deve arrastar o Zod
 * junto para o bundle do navegador.
 *
 * A mensagem cita a primeira regra pendente em vez de repetir a lista inteira:
 * a checklist ao lado do campo já mostra tudo.
 */
export const strongPassword = () =>
  z.string().superRefine((value, ctx) => {
    if (isStrongPassword(value)) return;
    ctx.addIssue({
      code: "custom",
      message: value
        ? `Senha fraca. Falta: ${firstPasswordIssue(value)?.toLowerCase()}.`
        : "Informe uma senha.",
    });
  });
