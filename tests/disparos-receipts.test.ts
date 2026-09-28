import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  candidate: vi.fn(),
  create: vi.fn(),
  updateReceipt: vi.fn(),
  count: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    broadcastReceipt: {
      findMany: mocks.find,
      createMany: mocks.create,
      update: mocks.updateReceipt,
    },
    broadcastRecipient: {
      findFirst: mocks.candidate,
      count: mocks.count,
      updateMany: mocks.update,
    },
  },
}));
import {
  receiveBroadcastReceipt,
  reconcileBroadcastReceipts,
} from "@/modules/broadcasts/receipts";
import type { MetaDeliveryReceipt } from "@/modules/whatsapp/meta-events";
const receipt = (
  status: MetaDeliveryReceipt["status"],
): MetaDeliveryReceipt => ({
  messageId: "wa",
  phoneNumberId: "p",
  recipientPhone: "5511987654321",
  occurredAt: new Date(),
  status,
  error: status === "failed" ? "falha" : null,
});
let state: Record<string, unknown>;
beforeEach(() => {
  vi.resetAllMocks();
  state = { readAt: null, deliveredAt: null, deliveryStatus: null };
  mocks.count.mockResolvedValue(1);
  mocks.candidate.mockResolvedValue({ id: "r" });
  mocks.find.mockResolvedValue([]);
  mocks.update.mockImplementation(async ({ where, data }) => {
    if (
      Object.entries(where).some(
        ([key, value]) => key in state && state[key] !== value,
      )
    )
      return { count: 0 };
    Object.assign(state, data);
    return { count: 1 };
  });
});
async function apply(status: MetaDeliveryReceipt["status"]) {
  mocks.find.mockResolvedValue([
    {
      ...receipt(status),
      id: "receipt",
      tenantId: "t",
      receivedAt: new Date(),
    },
  ]);
  await reconcileBroadcastReceipts("t", "wa");
}
describe("retornos de entrega", () => {
  it.each([
    ["read", "delivered", "sent", "failed"],
    ["failed", "delivered", "read", "sent"],
    ["delivered", "read", "read", "failed"],
  ] as MetaDeliveryReceipt["status"][][])(
    "não regride nem duplica eventos fora de ordem: %j",
    async (...statuses) => {
      for (const status of statuses) await apply(status);
      expect(state.deliveryStatus).toBe("read");
      expect(state.deliveryError).toBeNull();
    },
  );
  it("falha posterior à aceitação é visível sem reabrir envio", async () => {
    await apply("sent");
    await apply("failed");
    expect(state.deliveryStatus).toBe("failed");
    expect(
      mocks.update.mock.calls.every(([arg]) => !("status" in arg.data)),
    ).toBe(true);
  });
  it("guarda callback recebido antes do commit e reaplica depois", async () => {
    mocks.count.mockResolvedValue(0);
    mocks.find.mockResolvedValue([
      { ...receipt("delivered"), id: "early", receivedAt: new Date() },
    ]);
    await receiveBroadcastReceipt("t", receipt("delivered"));
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
    expect(mocks.updateReceipt).not.toHaveBeenCalled();
    mocks.count.mockResolvedValue(1);
    await reconcileBroadcastReceipts("t", "wa");
    expect(state.deliveryStatus).toBe("delivered");
  });
  it("restringe recibos por tenant, remetente e destinatário", async () => {
    await apply("read");
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          campaign: { tenantId: "t", phoneNumberId: "p" },
          whatsappMessageId: "wa",
          phone: { in: expect.arrayContaining(["5511987654321"]) },
        }),
      }),
    );
  });
  it("ignora status de mensagens sem campanha correspondente", async () => {
    mocks.candidate.mockResolvedValue(null);
    await receiveBroadcastReceipt("other", receipt("read"));
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
