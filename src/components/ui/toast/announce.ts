import { failureMessage, loadingMessage, readResult, successMessage } from "./messages";
import type { ToastApi } from "./toast-provider";
import type { ActionResult, SaveContext, SaveStatus } from "./types";

/** Rota de entrada usada no aviso de sessão expirada. */
export const LOGIN_HREF = "/login";

/** Só o que `announce*` usa da API: facilita testar com um objeto simples. */
export type ToastSink = Pick<ToastApi, "show" | "dismiss">;

export function announceLoading(sink: ToastSink, id: string, ctx: SaveContext) {
  sink.show({ id, ...loadingMessage(ctx) });
}

/**
 * Traduz o retorno de um salvamento no toast certo, no mesmo `id` do
 * "Salvando…" — que vira sucesso ou erro no lugar. Devolve o estado resultante.
 *
 * `retry`, quando existe, vira o botão "Tentar novamente" — só nas falhas em
 * que repetir adianta (rede e servidor); nunca em dado inválido, sessão ou
 * permissão, onde repetir o mesmo envio dá o mesmo erro.
 */
export function announceResult(
  sink: ToastSink,
  id: string,
  ctx: SaveContext,
  result: ActionResult | null | undefined,
  retry?: () => void,
): SaveStatus {
  const read = readResult(result);

  if (read.status === "idle") {
    sink.dismiss(id);
    return "idle";
  }

  if (read.status === "success") {
    sink.show({ id, ...successMessage(ctx, read.message) });
    return "success";
  }

  const failure = failureMessage(ctx, read.input);
  sink.show({
    id,
    kind: failure.kind,
    title: failure.title,
    description: failure.description,
    action:
      failure.failure === "auth"
        ? { label: "Entrar", href: LOGIN_HREF }
        : failure.retryable && retry
          ? { label: "Tentar novamente", onClick: retry }
          : undefined,
  });
  return "error";
}
