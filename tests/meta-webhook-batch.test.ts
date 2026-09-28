import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  instance: vi.fn(),
  verify: vi.fn(),
  process: vi.fn(),
  receipt: vi.fn(),
  outcome: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { whatsappInstance: { findFirst: mocks.instance } },
}));
vi.mock("@/modules/whatsapp/meta-config", () => ({
  WHATSAPP_PROVIDER_SELECT: {},
  readMetaWebhookSecrets: () => ({ appSecret: "secret" }),
  verifyMetaWebhookSignature: mocks.verify,
  getWhatsAppProviderForInstance: () => ({ name: "meta" }),
}));
vi.mock("@/modules/whatsapp/process-incoming", () => ({
  processIncomingWhatsapp: mocks.process,
}));
vi.mock("@/modules/broadcasts/receipts", () => ({
  receiveBroadcastReceipt: mocks.receipt,
}));
vi.mock("@/modules/broadcasts/outcomes", () => ({
  recordBroadcastResponse: mocks.outcome,
}));
import { POST } from "@/app/api/webhooks/whatsapp/meta/[tenantId]/route";
function request() {
  return new Request("http://localhost/api/webhooks/whatsapp/meta/t", {
    method: "POST",
    body: JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          changes: ["p", "other"].map((phone) => ({
            field: "messages",
            value: {
              metadata: { phone_number_id: phone },
              messages: ["a", "b"].map((id) => ({
                id,
                from: "5511987654321",
                type: "text",
                text: { body: "Oi" },
              })),
              statuses: [
                {
                  id: "wa",
                  recipient_id: "5511987654321",
                  timestamp: "1790500000",
                  status: "read",
                },
              ],
            },
          })),
        },
      ],
    }),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.instance.mockResolvedValue({
    status: "connected",
    metaPhoneNumberId: "p",
  });
  mocks.verify.mockReturnValue(true);
  mocks.process.mockResolvedValue({ body: { ok: true } });
});
describe("rota de lotes Meta", () => {
  it("processa todo lote apenas do remetente autenticado", async () => {
    expect(
      (await POST(request(), { params: Promise.resolve({ tenantId: "t" }) }))
        .status,
    ).toBe(200);
    expect(mocks.process).toHaveBeenCalledTimes(2);
    expect(mocks.receipt).toHaveBeenCalledTimes(1);
    expect(mocks.outcome).toHaveBeenCalledTimes(2);
  });
  it("continua os eventos restantes quando um falha e solicita reentrega", async () => {
    mocks.process.mockRejectedValueOnce(new Error("temporário"));
    expect(
      (await POST(request(), { params: Promise.resolve({ tenantId: "t" }) }))
        .status,
    ).toBe(500);
    expect(mocks.process).toHaveBeenCalledTimes(2);
    expect(mocks.outcome).toHaveBeenCalledTimes(1);
  });
  it("assinatura inválida nunca processa conteúdo", async () => {
    mocks.verify.mockReturnValue(false);
    expect(
      (await POST(request(), { params: Promise.resolve({ tenantId: "t" }) }))
        .status,
    ).toBe(401);
    expect(mocks.process).not.toHaveBeenCalled();
    expect(mocks.receipt).not.toHaveBeenCalled();
  });
  it("desconectado ainda atualiza recibos dos envios anteriores", async () => {
    mocks.instance.mockResolvedValue({
      status: "disconnected",
      metaPhoneNumberId: "p",
    });
    await POST(request(), { params: Promise.resolve({ tenantId: "t" }) });
    expect(mocks.process).not.toHaveBeenCalled();
    expect(mocks.receipt).toHaveBeenCalledTimes(1);
  });
});
