import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BitrixFailure, createBitrixClient, externalId, parseWebhook, verifyBitrix } from "@/modules/bitrix/client";
let caseNumber = 0;
const webhook = "https://contrato.bitrix24.com.br/rest/1/testsecret123/";
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(Date.UTC(2030, 0, ++caseNumber))); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
async function settle<T>(promise: Promise<T>) {
  const result = promise.then((value) => ({ value }), (error: unknown) => ({ error }));
  await vi.runAllTimersAsync();
  return result;
}
function response(result: unknown, status = 200) { return new Response(JSON.stringify({ result }), { status }); }
describe("Bitrix24: transporte e credenciais", () => {
  it("aceita URL base de portal oficial e normaliza a barra final", () => {
    expect(parseWebhook(webhook.slice(0, -1))).toEqual({ url: webhook, host: "contrato.bitrix24.com.br", userId: "1" });
    expect(parseWebhook("https://empresa.bitrix24.eu/rest/22/testsecret123/").userId).toBe("22");
  });
  it.each([
    "http://empresa.bitrix24.com/rest/1/testsecret123/", "https://127.0.0.1/rest/1/testsecret123/",
    "https://empresa.bitrix24.com.evil.test/rest/1/testsecret123/", "https://bitrix24.com/rest/1/testsecret123/",
    "https://evil.test/rest/1/testsecret123/", "https://empresa.bitrix24.com:8443/rest/1/testsecret123/",
    "https://u:p@empresa.bitrix24.com/rest/1/testsecret123/", "https://empresa.bitrix24.com/rest/1/testsecret123/?x=y",
    "https://empresa.bitrix24.com/rest/1/testsecret123/#x", "https://empresa.bitrix24.com/rest/1/testsecret123/profile.json",
  ])("recusa destino inseguro ou URL errada: %s", (url) => {
    expect(() => parseWebhook(url)).toThrow(BitrixFailure);
  });
  it("envia JSON no servidor, sem cache e sem seguir redirecionamentos", async () => {
    const fetcher = vi.fn().mockResolvedValue(response(1)); vi.stubGlobal("fetch", fetcher);
    expect(await settle(createBitrixClient(webhook)("crm.settings.mode.get"))).toEqual({ value: 1 });
    expect(fetcher).toHaveBeenCalledWith(`${webhook}crm.settings.mode.get.json`, expect.objectContaining({ method: "POST", cache: "no-store", redirect: "error", body: "{}" }));
  });
  it("não expõe erro remoto ou segredo e reconhece erro dentro de HTTP 200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "ACCESS_DENIED", error_description: `secret at ${webhook}` }))));
    const result = await settle(createBitrixClient(webhook)("crm.item.add", {}));
    expect(result).toHaveProperty("error");
    if ("error" in result) { expect(result.error).toBeInstanceOf(BitrixFailure); expect(String(result.error)).not.toContain("testsecret123"); expect((result.error as BitrixFailure).uncertain).toBe(false); }
  });
  it.each(["crm.item.add", "crm.activity.add"] as const)("timeout de criação %s fica incerto", async (method) => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Timeout")));
    const result = await settle(createBitrixClient(webhook)(method));
    expect(result).toHaveProperty("error.uncertain", true);
  });
  it("limite do portal produz recuo sem prender a fila por minutos", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "QUERY_LIMIT_EXCEEDED" }), { status: 429, headers: { "retry-after": "120" } }));
    vi.stubGlobal("fetch", fetcher); const call = createBitrixClient(webhook);
    expect(await settle(call("crm.item.list"))).toHaveProperty("error.retryAfter", 120_000);
    const started = Date.now();
    expect(await settle(call("crm.item.list"))).toHaveProperty("error");
    expect(Date.now() - started).toBeLessThan(1000); expect(fetcher).toHaveBeenCalledOnce();
  });
  it("pausa/desconexão bloqueia a chamada imediatamente antes do envio", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    expect(await settle(createBitrixClient(webhook, async () => false)("crm.activity.add"))).toHaveProperty("error");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("valida conexão com leituras sem criar contatos/reuniões de teste", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(2)).mockResolvedValueOnce(response({ items: [] })).mockResolvedValueOnce(response({ TYPE_ID: {} }));
    vi.stubGlobal("fetch", fetcher);
    expect(await settle(verifyBitrix(webhook, true))).toEqual({ value: 2 });
    const urls = fetcher.mock.calls.map(([url]) => String(url));
    expect(urls).toHaveLength(3); expect(urls.some((url) => url.includes(".add"))).toBe(false);
  });
  it("não arredonda identificador remoto fora do alcance seguro", () => {
    expect(externalId.parse("9007199254740993")).toBe("9007199254740993");
    expect(externalId.safeParse(9007199254740993).success).toBe(false);
  });
});

it("erro remoto sem código também é recusado", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "", error_description: "Sensitive remote details", result: false }))));
  const result = await settle(createBitrixClient(webhook)("crm.item.add"));
  expect(result).toHaveProperty("error");
  expect(JSON.stringify(result)).not.toContain("Sensitive remote details");
});
