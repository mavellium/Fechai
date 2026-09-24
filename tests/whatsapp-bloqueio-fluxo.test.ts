import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  instanceFindFirst: vi.fn(),
  blockedFindUnique: vi.fn(),
  getOrCreateConversation: vi.fn(),
  resolveAgent: vi.fn(),
  runAgentTurn: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    whatsappInstance: { findFirst: mocks.instanceFindFirst },
    whatsappBlockedNumber: { findUnique: mocks.blockedFindUnique },
  },
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ allowed: true })),
}));
vi.mock("@/modules/agent-engine/conversation", () => ({
  appendMessage: vi.fn(),
  getOrCreateConversation: mocks.getOrCreateConversation,
}));
vi.mock("@/modules/agent-engine/orchestrator", () => ({
  resolveAgent: mocks.resolveAgent,
  runAgentTurn: mocks.runAgentTurn,
}));
vi.mock("@/modules/agent-engine/handoff", () => ({ addLeadToHandoffGroup: vi.fn() }));
vi.mock("@/modules/ai/transcribe", () => ({ transcribeAudio: vi.fn() }));
vi.mock("@/modules/voice/reply", () => ({ speakReply: vi.fn() }));
vi.mock("@/modules/voice/storage", () => ({ storeVoiceMessage: vi.fn() }));

import { EvolutionProvider } from "@/modules/whatsapp/evolution";
import { processIncomingWhatsapp } from "@/modules/whatsapp/process-incoming";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.instanceFindFirst.mockResolvedValue({
    tenantId: "tenant-1",
    status: "connected",
    tenant: { whatsappIgnoreGroups: false },
  });
  mocks.blockedFindUnique.mockImplementation(async ({ where }) =>
    where.tenantId_phone.tenantId === "tenant-1" &&
    where.tenantId_phone.phone === "1187654321"
      ? { id: "block-1" }
      : null,
  );
});

describe("bloqueio no fluxo completo de entrada", () => {
  it("ignora o telefone bloqueado quando a Evolution envia um LID e o número alternativo", async () => {
    const provider = new EvolutionProvider();
    const incoming = provider.parseWebhook({
      instance: "instance-1",
      data: {
        key: {
          remoteJid: "11927141003400@lid",
          remoteJidAlt: "5511987654321@s.whatsapp.net",
          fromMe: false,
          id: "message-1",
        },
        message: { conversation: "Olá" },
      },
    });

    expect(incoming).not.toBeNull();
    const result = await processIncomingWhatsapp(incoming!, provider);

    expect(result.body).toEqual({ ignored: "número bloqueado" });
    expect(mocks.blockedFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId_phone: { tenantId: "tenant-1", phone: "1187654321" } },
      }),
    );
    expect(mocks.getOrCreateConversation).not.toHaveBeenCalled();
    expect(mocks.resolveAgent).not.toHaveBeenCalled();
    expect(mocks.runAgentTurn).not.toHaveBeenCalled();
  });
});
