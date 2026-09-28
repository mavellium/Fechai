import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MetaCloudProvider,
  MetaBroadcastRejected,
} from "@/modules/whatsapp/meta";
const provider = new MetaCloudProvider({
  phoneNumberId: "123",
  businessAccountId: "456",
  accessToken: "secret-test",
});
const template = {
  id: "t",
  name: "convite",
  language: "pt_BR",
  body: "Olá {{1}}",
  header: "",
  footer: "",
  parameterCount: 1,
};
afterEach(() => vi.unstubAllGlobals());

describe("Meta: disparos", () => {
  it("envia template e idioma, com variáveis na ordem, usando o número configurado", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ messages: [{ id: "wamid.out" }] })),
      );
    vi.stubGlobal("fetch", fetchMock);
    expect(
      await provider.sendBroadcastTemplate("5511987654321", template, ["Ana"]),
    ).toBe("wamid.out");
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/123\/messages$/);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "5511987654321",
      type: "template",
      template: {
        name: "convite",
        language: { code: "pt_BR" },
        components: [
          { type: "body", parameters: [{ type: "text", text: "Ana" }] },
        ],
      },
    });
  });
  it("não declara sucesso sem id e diferencia recusa de falha ambígua", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}")));
    await expect(
      provider.sendBroadcastTemplate("5511987654321", template, ["Ana"]),
    ).rejects.toThrow("identificador");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: 132000, message: "segredo que não deve vazar" },
          }),
          { status: 400 },
        ),
      ),
    );
    await expect(
      provider.sendBroadcastTemplate("5511987654321", template, ["Ana"]),
    ).rejects.toBeInstanceOf(MetaBroadcastRejected);
  });
  it("pagina templates sem enviar token para a URL next da resposta", async () => {
    const item = {
      id: "t1",
      name: "ola",
      language: "pt_BR",
      status: "APPROVED",
      components: [{ type: "BODY", text: "Olá" }],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [item],
            paging: {
              next: "https://untrusted.example/",
              cursors: { after: "cursor" },
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: [{ ...item, id: "t2", status: "REJECTED" }] }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    expect(await provider.listBroadcastTemplates()).toHaveLength(1);
    expect(fetchMock.mock.calls[1][0]).toContain("graph.facebook.com");
    expect(fetchMock.mock.calls[1][0]).toContain("after=cursor");
  });
});
