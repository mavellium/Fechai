import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingMessage } from "@/modules/whatsapp/provider";

const mocks = vi.hoisted(() => ({
  incoming: null as IncomingMessage | null,
  instanceFindFirst: vi.fn(),
  messageFindUnique: vi.fn(),
  messageFindFirst: vi.fn(),
  conversationUpdate: vi.fn(),
  getOrCreateConversation: vi.fn(),
  resolveAgent: vi.fn(),
  addLeadToHandoffGroup: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    whatsappInstance: { findFirst: mocks.instanceFindFirst },
    message: {
      findUnique: mocks.messageFindUnique,
      findFirst: mocks.messageFindFirst,
    },
    conversation: { update: mocks.conversationUpdate },
  },
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ allowed: true })),
}));
vi.mock("@/modules/whatsapp", () => ({
  getWhatsAppProvider: () => ({ parseWebhook: () => mocks.incoming }),
}));
vi.mock("@/modules/whatsapp/blocklist", () => ({
  isPhoneBlocked: vi.fn(async () => false),
}));
vi.mock("@/modules/agent-engine/conversation", () => ({
  appendMessage: vi.fn(),
  getOrCreateConversation: mocks.getOrCreateConversation,
}));
vi.mock("@/modules/agent-engine/orchestrator", () => ({
  runAgentTurn: vi.fn(),
  resolveAgent: mocks.resolveAgent,
}));
vi.mock("@/modules/agent-engine/handoff", () => ({
  addLeadToHandoffGroup: mocks.addLeadToHandoffGroup,
}));
vi.mock("@/modules/ai/transcribe", () => ({ transcribeAudio: vi.fn() }));
vi.mock("@/modules/voice/reply", () => ({ speakReply: vi.fn() }));

import { POST } from "@/app/api/webhooks/whatsapp/route";

const BASE: IncomingMessage = {
  instanceExternalId: "instancia-1",
  fromPhone: "5511999999999",
  fromName: "Cliente",
  text: "👍",
  isGroup: false,
  hasAudio: false,
  isReaction: true,
  isFromMe: true,
  messageKeyId: "reacao-1",
};

function request() {
  return new Request("https://fechai.test/api/webhooks/whatsapp", {
    method: "POST",
    headers: { "x-webhook-secret": "segredo-teste" },
    body: "{}",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.WHATSAPP_WEBHOOK_SECRET = "segredo-teste";
  mocks.incoming = { ...BASE };
  mocks.instanceFindFirst.mockResolvedValue({
    tenantId: "tenant-1",
    tenant: { whatsappIgnoreGroups: false },
  });
  mocks.resolveAgent.mockResolvedValue({ id: "agente-1", stopOnEmoji: true });
  mocks.getOrCreateConversation.mockResolvedValue({
    lead: { isTest: false },
    conversation: { id: "conversa-1" },
  });
  mocks.conversationUpdate.mockResolvedValue({});
  mocks.addLeadToHandoffGroup.mockResolvedValue(undefined);
});

describe("reação no webhook do WhatsApp", () => {
  it("reação do atendente pausa o agente e marca a conversa", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.conversationUpdate).toHaveBeenCalledWith({
      where: { id: "conversa-1" },
      data: { agentPaused: true, needsHuman: true },
    });
    expect(mocks.addLeadToHandoffGroup).toHaveBeenCalledWith(
      "tenant-1",
      "agente-1",
      "5511999999999",
      { isTest: false },
    );
  });

  it("reação do cliente não altera nem cria conversa", async () => {
    mocks.incoming = { ...BASE, isFromMe: false };

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.getOrCreateConversation).not.toHaveBeenCalled();
    expect(mocks.conversationUpdate).not.toHaveBeenCalled();
    expect(mocks.addLeadToHandoffGroup).not.toHaveBeenCalled();
  });

  it("a opção desligada ignora a reação do atendente", async () => {
    mocks.resolveAgent.mockResolvedValue({ id: "agente-1", stopOnEmoji: false });

    await POST(request());

    expect(mocks.getOrCreateConversation).not.toHaveBeenCalled();
    expect(mocks.conversationUpdate).not.toHaveBeenCalled();
  });
});
