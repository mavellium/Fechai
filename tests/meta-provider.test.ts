import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MetaCloudProvider } from "@/modules/whatsapp/meta";
import { verifyMetaWebhookSignature } from "@/modules/whatsapp/meta-config";

const provider = () =>
  new MetaCloudProvider({
    phoneNumberId: "1234567890",
    businessAccountId: "9876543210",
    accessToken: "token-permanente-de-teste",
  });

beforeEach(() => {
  process.env.META_GRAPH_API_VERSION = "v26.0";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Meta Cloud API — envio", () => {
  it("envia texto no Phone Number ID e devolve o wamid", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ messages: [{ id: "wamid.abc" }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(provider().sendMessage("1234567890", "5511999990000", "Olá")).resolves.toBe(
      "wamid.abc",
    );
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v26.0/1234567890/messages");
    expect(init.headers).toMatchObject({ Authorization: "Bearer token-permanente-de-teste" });
    expect(JSON.parse(String(init.body))).toMatchObject({
      messaging_product: "whatsapp",
      to: "5511999990000",
      type: "text",
      text: { body: "Olá" },
    });
  });

  it("faz upload do áudio antes de referenciá-lo na mensagem", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "media-1" }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ messages: [{ id: "wamid.audio" }] }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const id = await provider().sendAudio("1234567890", "5511999990000", {
      base64: Buffer.from("ogg-opus").toString("base64"),
      mime: "audio/ogg",
    });

    expect(id).toBe("wamid.audio");
    expect(String(fetchMock.mock.calls[0][0])).toContain("/1234567890/media");
    const second = fetchMock.mock.calls[1][1] as RequestInit;
    expect(JSON.parse(String(second.body))).toMatchObject({
      type: "audio",
      audio: { id: "media-1", voice: true },
    });
  });
});

describe("Meta Cloud API — webhook", () => {
  const textPayload = {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: "1234567890" },
              contacts: [{ wa_id: "5511999990000", profile: { name: "Ana" } }],
              messages: [
                {
                  id: "wamid.in",
                  from: "5511999990000",
                  type: "text",
                  text: { body: "Quero agendar" },
                },
              ],
            },
          },
        ],
      },
    ],
  };

  it("normaliza uma mensagem de texto para o contrato comum", () => {
    expect(provider().parseWebhook(textPayload)).toMatchObject({
      instanceExternalId: "1234567890",
      fromPhone: "5511999990000",
      fromName: "Ana",
      text: "Quero agendar",
      messageKeyId: "wamid.in",
      isGroup: false,
      isFromMe: false,
    });
  });

  it("preserva o media id separado do id da mensagem", () => {
    const payload = structuredClone(textPayload);
    payload.entry[0].changes[0].value.messages[0] = {
      id: "wamid.audio-in",
      from: "5511999990000",
      type: "audio",
      audio: { id: "media-in", mime_type: "audio/ogg" },
    } as never;

    expect(provider().parseWebhook(payload)).toMatchObject({
      hasAudio: true,
      messageKeyId: "wamid.audio-in",
      mediaId: "media-in",
    });
  });

  it("ignora atualizações de status, que não são fala do contato", () => {
    const payload = structuredClone(textPayload);
    const value = payload.entry[0].changes[0].value as unknown as Record<string, unknown>;
    delete value.messages;
    value.statuses = [{ id: "wamid.out", status: "delivered" }];
    expect(provider().parseWebhook(payload)).toBeNull();
  });

  it("valida X-Hub-Signature-256 sobre os bytes exatos", () => {
    const body = JSON.stringify(textPayload);
    const secret = "app-secret-de-teste";
    const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    expect(verifyMetaWebhookSignature(body, signature, secret)).toBe(true);
    expect(verifyMetaWebhookSignature(`${body} `, signature, secret)).toBe(false);
    expect(verifyMetaWebhookSignature(body, "sha256=invalida", secret)).toBe(false);
  });
});
