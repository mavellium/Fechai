import { z } from "zod";

// Only official cloud portal hosts: no user-controlled private addresses or redirects.
const ZONES = "com|com\\.br|eu|de|fr|pl|es|cn|com\\.tr|in|vn|jp|id|it|co|mx|uk|ae|ru";
const HOST = new RegExp(`^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.bitrix24\\.(?:${ZONES})$`, "i");
const URL_ERROR = "Cole a URL do webhook de entrada de um portal Bitrix24 na nuvem, terminando no código secreto.";
export class BitrixFailure extends Error {
  constructor(message: string, readonly uncertain = false, readonly retryAfter = 60_000) { super(message); }
}
export function parseWebhook(input: string) {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new BitrixFailure(URL_ERROR); }
  const path = url.pathname.match(/^\/rest\/([1-9]\d{0,14})\/([a-zA-Z0-9_-]{8,128})\/?$/);
  if (url.protocol !== "https:" || !HOST.test(url.hostname) || url.port || url.username || url.password || url.search || url.hash || !path) {
    throw new BitrixFailure(URL_ERROR);
  }
  return { url: `https://${url.hostname}/rest/${path[1]}/${path[2]}/`, host: url.hostname, userId: path[1] };
}
export const externalId = z.union([z.string().regex(/^[1-9]\d*$/), z.number().int().positive().max(Number.MAX_SAFE_INTEGER)]).transform(String);
export const itemResult = z.object({ item: z.object({ id: externalId }).passthrough() });
export const itemList = z.object({ items: z.array(z.object({ id: externalId }).passthrough()) });
export type BitrixCall = (method: Method, params?: Record<string, unknown>) => Promise<unknown>;
export type Method = "crm.settings.mode.get" | "crm.item.list" | "crm.item.get" | "crm.item.add" | "crm.item.update" |
  "crm.duplicate.findbycomm" | "crm.activity.list" | "crm.activity.add" | "crm.activity.update" | "crm.activity.fields";
const turns = new Map<string, Promise<void>>();
const nextCalls = new Map<string, number>();
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A single paced request at a time per portal, including concurrent connect/test actions. */
export function createBitrixClient(webhook: string, active?: () => Promise<boolean>): BitrixCall {
  const target = parseWebhook(webhook);
  return async (method, params = {}) => {
    let release!: () => void;
    const previous = turns.get(target.host) ?? Promise.resolve();
    const done = new Promise<void>((resolve) => { release = resolve; });
    turns.set(target.host, done);
    await previous;
    const creating = method.endsWith(".add");
    try {
      const wait = Math.max(0, (nextCalls.get(target.host) ?? 0) - Date.now());
      if (wait > 1000) throw new BitrixFailure("O Bitrix24 pediu uma pausa. O envio será retomado automaticamente.", false, wait);
      await pause(wait);
      if (active && !(await active())) throw new BitrixFailure("A conexão foi pausada ou alterada. O envio aguarda a conexão correta.");
      let response: Response;
      try {
        response = await fetch(`${target.url}${method}.json`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params),
          cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
        });
      } catch { throw new BitrixFailure("Não foi possível confirmar o envio ao Bitrix24. Vamos conferir antes de tentar novamente.", creating); }
      let body: unknown;
      try { body = await response.json(); } catch { throw new BitrixFailure("O Bitrix24 não confirmou o resultado. O envio será conferido.", creating); }
      const envelope = z.object({ result: z.unknown().optional(), error: z.string().optional(), error_description: z.string().optional() }).safeParse(body);
      const code = envelope.success ? envelope.data.error : undefined;
      const hasError = envelope.success && (envelope.data.error !== undefined || envelope.data.error_description !== undefined);
      if (response.status === 429 || code === "QUERY_LIMIT_EXCEEDED" || code === "OPERATION_TIME_LIMIT") {
        const wait = Math.min(3_600_000, Math.max(60_000, Number(response.headers.get("retry-after")) * 1000 || 60_000));
        nextCalls.set(target.host, Date.now() + wait);
        throw new BitrixFailure("O Bitrix24 pediu uma pausa. O envio será retomado automaticamente.", false, wait);
      }
      if (response.status === 401 || response.status === 403 || ["INVALID_CREDENTIALS", "NO_AUTH_FOUND", "ACCESS_DENIED", "insufficient_scope", "expired_token"].includes(code ?? "")) {
        throw new BitrixFailure("Confira o webhook, o acesso à API e as permissões de CRM do responsável no Bitrix24.", false, 900_000);
      }
      if (!response.ok || !envelope.success || hasError || envelope.data.result === undefined) {
        throw new BitrixFailure("O Bitrix24 recusou o envio. Confira permissões e campos obrigatórios no CRM.", creating && (response.status >= 500 || !envelope.success || (!hasError && response.ok)));
      }
      return envelope.data.result;
    } finally {
      nextCalls.set(target.host, Math.max(Date.now() + 550, nextCalls.get(target.host) ?? 0));
      release();
      if (turns.get(target.host) === done) turns.delete(target.host);
    }
  };
}

/** Read-only verification: never creates a sample contact or calendar event. */
export async function verifyBitrix(webhook: string, appointments: boolean) {
  const call = createBitrixClient(webhook);
  const mode = z.union([z.literal(1), z.literal(2)]).parse(Number(await call("crm.settings.mode.get")));
  itemList.parse(await call("crm.item.list", { entityTypeId: 3, select: ["id"], filter: { id: 0 } }));
  if (appointments) await call("crm.activity.fields");
  return mode;
}
