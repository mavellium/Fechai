import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Testes do adapter da Evolution API.
 *
 * Os dois casos aqui vêm de um incidente em produção em que a tela mostrava o
 * número "conectado" e nada funcionava:
 *
 * - `Evolution logout falhou (404)`: o desconectar mandava POST numa rota que
 *   a Evolution v2 registra como DELETE. O Express não acha handler e devolve
 *   o 404 genérico — que parece "instância não existe", e mandava a gente
 *   procurar o problema no lugar errado;
 * - "0 mensagens recebidas": as instâncias ficavam penduradas no webhook
 *   GLOBAL da Evolution, que não sabe mandar header. Como a nossa rota recusa
 *   (401) o que não trouxer `x-webhook-secret`, e 401 está na lista de status
 *   que a Evolution NÃO reentrega, toda mensagem era descartada em silêncio.
 *
 * Verbo e header são invisíveis em code review e só falham em produção. Por
 * isso estão travados aqui.
 */

const URL_BASE = "https://evo.example.test";
const CHAVE = "apikey-de-teste";
const SEGREDO = "segredo-do-webhook";
const WEBHOOK = "https://app.example.test/api/webhooks/whatsapp";

type Chamada = { url: string; init: RequestInit };

let chamadas: Chamada[] = [];
let fetchMock: ReturnType<typeof vi.fn>;

/** Cria o provider já com o ambiente aplicado (os campos leem env no construtor). */
async function novoProvider() {
  const { EvolutionProvider } = await import("@/modules/whatsapp/evolution");
  return new EvolutionProvider();
}

function corpo(chamada: Chamada): Record<string, unknown> {
  return JSON.parse(String(chamada.init.body));
}

beforeEach(() => {
  vi.resetModules();
  process.env.EVOLUTION_API_URL = URL_BASE;
  process.env.EVOLUTION_API_KEY = CHAVE;
  process.env.EVOLUTION_WEBHOOK_URL = WEBHOOK;
  process.env.WHATSAPP_WEBHOOK_SECRET = SEGREDO;
  chamadas = [];
  fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    chamadas.push({ url: String(url), init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ key: { id: "MSG1" } }),
      text: async () => "",
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Desconectar o número (disconnect)", () => {
  it("usa DELETE — POST cai no 404 genérico do Express", async () => {
    const provider = await novoProvider();
    await provider.disconnect("tenant_abc");

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].url).toBe(`${URL_BASE}/instance/logout/tenant_abc`);
    expect(chamadas[0].init.method).toBe("DELETE");
  });

  it("propaga a falha em vez de fingir que desconectou", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 } as unknown as Response);
    const provider = await novoProvider();
    await expect(provider.disconnect("tenant_abc")).rejects.toThrow(/404/);
  });
});

describe("Webhook da instância", () => {
  it("manda o segredo no header — sem ele a nossa rota devolve 401", async () => {
    const provider = await novoProvider();
    const configurou = await provider.ensureWebhook("tenant_abc");

    expect(configurou).toBe(true);
    const escrita = chamadas.find((chamada) => chamada.init.method === "POST")!;
    expect(escrita.url).toBe(`${URL_BASE}/webhook/set/tenant_abc`);
    const webhook = corpo(escrita).webhook as Record<string, unknown>;
    expect(webhook.enabled).toBe(true);
    expect(webhook.url).toBe(WEBHOOK);
    expect(webhook.headers).toMatchObject({ "x-webhook-secret": SEGREDO });
  });

  it("assina só os eventos que o app consome", async () => {
    const provider = await novoProvider();
    await provider.ensureWebhook("tenant_abc");

    const escrita = chamadas.find((chamada) => chamada.init.method === "POST")!;
    const webhook = corpo(escrita).webhook as { events: string[] };
    // Lista vazia faz a Evolution assinar TODOS os eventos — aí cada "digitando"
    // de cada contato vira uma request na nossa rota.
    expect(webhook.events.length).toBeGreaterThan(0);
    expect(webhook.events).toContain("MESSAGES_UPSERT");
    expect(webhook.events).not.toContain("PRESENCE_UPDATE");
  });

  it("só lê quando o webhook já está saudável", async () => {
    fetchMock.mockImplementationOnce(async (url: string, init: RequestInit = {}) => {
      chamadas.push({ url: String(url), init });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          enabled: true,
          url: WEBHOOK,
          headers: { "X-Webhook-Secret": SEGREDO },
          events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE", "QRCODE_UPDATED"],
        }),
        text: async () => "",
      } as unknown as Response;
    });
    const provider = await novoProvider();

    expect(await provider.ensureWebhook("tenant_abc")).toBe(true);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].url).toBe(`${URL_BASE}/webhook/find/tenant_abc`);
    expect(chamadas[0].init.method).toBeUndefined();
  });

  it("repara automaticamente URL, eventos ou header perdidos", async () => {
    fetchMock.mockImplementationOnce(async (url: string, init: RequestInit = {}) => {
      chamadas.push({ url: String(url), init });
      return {
        ok: true,
        status: 200,
        json: async () => ({ enabled: true, url: "", headers: null, events: [] }),
        text: async () => "",
      } as unknown as Response;
    });
    const provider = await novoProvider();

    expect(await provider.ensureWebhook("tenant_abc")).toBe(true);
    expect(chamadas).toHaveLength(2);
    expect(chamadas[1].url).toBe(`${URL_BASE}/webhook/set/tenant_abc`);
    expect(chamadas[1].init.method).toBe("POST");
  });

  it("a instância nova já nasce com o webhook configurado", async () => {
    const provider = await novoProvider();
    await provider.createInstance("abc");

    expect(chamadas[0].url).toBe(`${URL_BASE}/instance/create`);
    const webhook = corpo(chamadas[0]).webhook as Record<string, unknown>;
    expect(webhook.headers).toMatchObject({ "x-webhook-secret": SEGREDO });
  });

  it("sem segredo, não configura nada — melhor sem webhook que tomando 401 calado", async () => {
    delete process.env.WHATSAPP_WEBHOOK_SECRET;
    const provider = await novoProvider();

    expect(await provider.ensureWebhook("tenant_abc")).toBe(false);
    expect(chamadas).toHaveLength(0);

    await provider.createInstance("abc");
    expect(corpo(chamadas[0])).not.toHaveProperty("webhook");
  });

  it("sem URL de webhook, idem", async () => {
    delete process.env.EVOLUTION_WEBHOOK_URL;
    const provider = await novoProvider();
    expect(await provider.ensureWebhook("tenant_abc")).toBe(false);
    expect(chamadas).toHaveLength(0);
  });
});
