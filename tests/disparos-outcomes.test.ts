import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  message: vi.fn(),
  recipient: vi.fn(),
  update: vi.fn(),
  appointment: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    message: { findFirst: mocks.message },
    broadcastRecipient: {
      findFirst: mocks.recipient,
      updateMany: mocks.update,
    },
    appointment: { findFirst: mocks.appointment },
  },
}));
import { recordBroadcastResponse } from "@/modules/broadcasts/outcomes";
const at = new Date("2026-09-27T12:00:00Z");
beforeEach(() => {
  vi.resetAllMocks();
  mocks.message.mockResolvedValue({
    id: "m",
    createdAt: at,
    conversation: { lead: { id: "l", status: "hot" } },
  });
  mocks.recipient.mockResolvedValue({
    id: "r",
    sentAt: new Date("2026-09-26T12:00:00Z"),
    leadStatusAtSend: "new",
    isTest: false,
  });
  mocks.appointment.mockResolvedValue(null);
});
describe("atribuição de resultados", () => {
  it("busca o último envio antes do instante original, no tenant e janela corretos", async () => {
    await recordBroadcastResponse("t", "5511987654321", "wa", at);
    expect(mocks.recipient).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          campaign: { tenantId: "t" },
          sentAt: { gte: new Date("2026-09-20T12:00:00Z"), lte: at },
        }),
        orderBy: [{ sentAt: "desc" }, { id: "desc" }],
      }),
    );
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "r", repliedAt: null },
      data: { repliedAt: at, firstReplyMessageId: "wa" },
    });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "r", qualifiedAt: null },
      data: { qualifiedAt: at },
    });
  });
  it("não conta mensagens que não foram registradas", async () => {
    mocks.message.mockResolvedValue(null);
    await recordBroadcastResponse("t", "5511987654321", "wa", at);
    expect(mocks.recipient).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("um teste mais recente impede atribuir sua resposta à campanha anterior", async () => {
    mocks.recipient.mockResolvedValue({ sentAt: at, isTest: true });
    await recordBroadcastResponse("t", "5511987654321", "wa", at);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("não conta oportunidade que já era quente antes do envio", async () => {
    mocks.recipient.mockResolvedValue({
      id: "r",
      sentAt: at,
      leadStatusAtSend: "hot",
      isTest: false,
    });
    await recordBroadcastResponse("t", "5511987654321", "wa", at);
    expect(mocks.update.mock.calls.some(([arg]) => arg.data.qualifiedAt)).toBe(
      false,
    );
  });
  it("consulta criada depois do envio e não cancelada registra um contato convertido", async () => {
    mocks.appointment.mockResolvedValue({ id: "appt" });
    await recordBroadcastResponse("t", "5511987654321", "wa", at);
    expect(mocks.appointment).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: "t",
          leadId: "l",
          status: { not: "canceled" },
          createdAt: {
            gte: new Date("2026-09-26T12:00:00Z"),
            lte: new Date("2026-10-03T12:00:00Z"),
          },
        }),
      }),
    );
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "r", appointmentId: null },
      data: { appointmentId: "appt" },
    });
  });
});
