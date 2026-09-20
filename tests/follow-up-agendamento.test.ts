import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  tenantAction: { findMany: vi.fn() },
  conversation: { findMany: vi.fn(), update: vi.fn() },
  whatsappInstance: { findUnique: vi.fn() },
  message: { create: vi.fn() },
}));
const provider = vi.hoisted(() => ({
  isConfigured: vi.fn(() => true),
  sendMessage: vi.fn(async () => "wamid-follow-up"),
}));

vi.mock("../src/lib/prisma", () => ({ prisma: db }));
vi.mock("../src/modules/whatsapp", () => ({ getWhatsAppProvider: () => provider }));

import { isEligible, scanAndSendFollowUps } from "../workers/follow-up-worker/scan";

const NOW = new Date("2026-09-20T12:00:00.000Z");
const OLD_INBOUND = new Date("2026-09-18T12:00:00.000Z");

function conversation(activeAppointments: { id: string }[] = []) {
  return {
    id: "conversa-1",
    tenantId: "tenant-1",
    agentId: "agente-1",
    needsHuman: false,
    followUpSentAt: null,
    lastInboundAt: OLD_INBOUND,
    lead: {
      id: "lead-1",
      phone: "5511999999999",
      isTest: false,
      appointments: activeAppointments,
    },
    messages: [{ role: "assistant" }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.tenantAction.findMany.mockResolvedValue([
    { tenantId: "tenant-1", agentId: "agente-1", config: { delayMinutes: 60, message: "Posso ajudar?" } },
  ]);
  db.whatsappInstance.findUnique.mockResolvedValue({
    externalId: "instancia-1",
    status: "connected",
  });
  db.message.create.mockResolvedValue({ id: "mensagem-1" });
  db.conversation.update.mockResolvedValue({});
});

describe("follow-up com consulta marcada", () => {
  it("a regra pura recusa contato com consulta atual ou futura", () => {
    expect(isEligible({
      needsHuman: false,
      followUpSentAt: null,
      lastInboundAt: OLD_INBOUND,
      lastRole: "assistant",
      hasActiveAppointment: true,
    }, new Date("2026-09-20T11:00:00.000Z"))).toBe(false);
  });

  it("a busca exclui consulta vinculada ao lead, inclusive a manual", async () => {
    db.conversation.findMany.mockResolvedValue([]);

    await scanAndSendFollowUps(NOW);

    expect(db.conversation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        lead: {
          appointments: {
            none: { status: "scheduled", endsAt: { gt: NOW } },
          },
        },
      }),
    }));
  });

  it("não envia mesmo se uma conversa com consulta escapar da consulta principal", async () => {
    db.conversation.findMany.mockResolvedValue([conversation([{ id: "consulta-1" }])]);

    await expect(scanAndSendFollowUps(NOW)).resolves.toEqual({ scanned: 1, sent: 0 });
    expect(provider.sendMessage).not.toHaveBeenCalled();
    expect(db.message.create).not.toHaveBeenCalled();
    expect(db.conversation.update).not.toHaveBeenCalled();
  });

  it("mantém o follow-up para contato sem consulta", async () => {
    db.conversation.findMany.mockResolvedValue([conversation()]);

    await expect(scanAndSendFollowUps(NOW)).resolves.toEqual({ scanned: 1, sent: 1 });
    expect(provider.sendMessage).toHaveBeenCalledWith(
      "instancia-1",
      "5511999999999",
      "Posso ajudar?",
    );
  });
});
