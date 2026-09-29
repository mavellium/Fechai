import { classifyFailure, sanitizeReason } from "./messages";
import type { ActionResult } from "./types";

/**
 * Camada de serviço do salvamento: transforma "o que deu errado" — resposta
 * HTTP, exceção, rede fora — no mesmo `ActionResult` que uma Server Action
 * devolve. O componente visual e o hook só conhecem esse formato.
 */

/** Exceções internas do Next (redirect, notFound) NÃO são falha: quem captura precisa relançá-las. */
export function isFrameworkSignal(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_");
}

/** Exceção → retorno padrão. Nunca inclui a mensagem crua de erro técnico. */
export function errorToResult(error: unknown): ActionResult {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : undefined;
  const code = classifyFailure({ message });
  // `server` é o padrão: a mensagem só acompanha se for texto para pessoas (ver `sanitizeReason`).
  return { ok: false, code, error: sanitizeReason(message) ?? undefined };
}

type ErrorBody = { error?: unknown; message?: unknown; errors?: unknown };

function readFieldErrors(value: unknown): ActionResult["errors"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: NonNullable<ActionResult["errors"]> = {};
  for (const [field, messages] of Object.entries(value)) {
    if (typeof messages === "string") out[field] = messages;
    else if (Array.isArray(messages) && messages.every((m) => typeof m === "string")) out[field] = messages;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * `fetch` para rotas `/api/*` que salvam algo, já no formato de retorno padrão:
 * status 401/403/422/5xx viram a categoria certa, corpo `{ error }`/`{ message }`
 * vira o motivo, `{ errors: { campo: … } }` vira erro por campo, e rede fora
 * (fetch lança) vira `network`. Nunca lança.
 */
export async function requestSave(input: RequestInfo | URL, init?: RequestInit): Promise<ActionResult> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch (error) {
    // Cancelamento (AbortController) não é falha de rede.
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return { ok: false, code: "network" };
  }

  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  const message =
    typeof body?.error === "string" ? body.error : typeof body?.message === "string" ? body.message : undefined;

  if (response.ok) return { ok: true, info: message };

  const errors = readFieldErrors(body?.errors);
  return {
    ok: false,
    code: classifyFailure({ status: response.status, message, errors }),
    error: sanitizeReason(message) ?? undefined,
    errors,
  };
}
