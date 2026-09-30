import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingMessage, WhatsAppProvider } from "@/modules/whatsapp/provider";

/**
 * Entrada de mensagens com as duas conexões: a conversa lembra por qual número
 * o contato fala, e a resposta sai pelo mesmo número em que ele escreveu.
 *
 * É esse registro (`Conversation.whatsappProvider`) que depois decide de qual
 * número saem a resposta manual, o follow-up e o lembrete. Errar aqui manda a
 * mensagem pelo número que o paciente nunca viu.
 */

const mocks = vi.hoisted(() => ({
  instanceFindFirst: vi.fn(),
  messageFindUnique: vi.fn(),
  messageFindFirst: vi.fn(),
  messageUpdate: vi.fn(),
  conversationUpdate: vi.fn(),
  getOrCreateConversation: vi.fn(),
  appendMessage: vi.fn(),
  resolveAgent: vi.fn(),
  runAgentTurn: vi.fn(),
  speakReply: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    whatsappInstance: { findFirst: mocks.instanceFindFirst },
    message: {
      findUnique: mocks.messageFindUnique,
      findFirst: mocks.messageFindFirst,
      update: mocks.messageUpdate,
    },
    conversation: { update: mocks.conversationUpdate },
  },
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn(async () => ({ allowed: true })) }));
vi.mock("@/modules/reports/events", () => ({ recordReportEvent: vi.fn(async () => {}) }));
vi.mock("@/modules/whatsapp/blocklist", () => ({ isPhoneBlocked: vi.fn(async () => false) }));
vi.mock("@/modules/agent-engine/conversation", () => ({
  appendMessage: mocks.appendMessage,
  getOrCreateConversation: mocks.getOrCreateConversation,
}));
vi.mock("@/modules/agent-engine/orchestrator", () => ({
  resolveAgent: mocks.resolveAgent,
  runAgentTurn: mocks.runAgentTurn,
}));
vi.mock("@/modules/agent-engine/handoff", () => ({ notifyHandoffGroup: vi.fn(async () => {}) }));
vi.mock("@/modules/ai/transcribe", () => ({ transcribeAudio: vi.fn() }));
vi.mock("@/modules/voice/reply", () => ({ speakReply: mocks.speakReply }));
vi.mock("@/modules/voice/storage", () => ({ storeVoiceMessage: vi.fn(async () => null) }));

import { processIncomingWhatsapp } from "@/modules/whatsapp/process-incoming";

const sendMessage = vi.fn<(...args: unknown[]) => Promise<string | null>>(async () => "key-resposta");
const fakeProvider = (name: string) =>
  ({ name, sendMessage, sendAudio: vi.fn(), getMediaAsBase64: vi.fn() }) as unknown as WhatsAppProvider;

const BASE: IncomingMessage = {
  instanceExternalId: "numero-1",
  fromPhone: "5511999999999",
  fromName: "Maria",
  text: "Oi, queria marcar uma avaliação",
  isGroup: false,
  hasAudio: false,
  messageKeyId: "msg-1",
};

/** As atualizações de canal (e só elas) que a entrada gravou na conversa. */
const canaisGravados = () =>
  mocks.conversationUpdate.mock.calls
    .map(([arg]) => arg as { where: { id: string }; data: Record<string, unknown> })
    .filter((arg) => "whatsappProvider" in arg.data)
    .map((arg) => arg.data.whatsappProvider);

function conversa(whatsappProvider: string | null) {
  mocks.getOrCreateConversation.mockResolvedValue({
    lead: { id: "lead-1", isTest: false },
    conversation: { id: "conv-1", whatsappProvider },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.instanceFindFirst.mockResolvedValue({
    tenantId: "tenant-1",
    status: "connected",
    tenant: { whatsappIgnoreGroups: false },
  });
  mocks.messageFindUnique.mockResolvedValue(null);
  mocks.messageFindFirst.mockResolvedValue(null);
  mocks.messageUpdate.mockResolvedValue({});
  mocks.conversationUpdate.mockResolvedValue({});
  mocks.appendMessage.mockResolvedValue({ id: "m-1" });
  mocks.resolveAgent.mockResolvedValue({ id: "agente-1", stopOnEmoji: true, listenAudio: false, speakReplies: false });
  mocks.runAgentTurn.mockResolvedValue({ reply: "Claro! Qual dia fica bom?", status: "ok", replyMessageId: "m-resp" });
  mocks.speakReply.mockResolvedValue({ spoken: false });
  conversa(null);
});

describe("Canal da conversa na entrada", () => {
  it("mensagem pela Meta: a conversa passa a ser da Meta e a resposta sai pelo mesmo número", async () => {
    conversa("evolution");

    const result = await processIncomingWhatsapp(BASE, fakeProvider("meta"));

    expect(result.body).toEqual({ ok: true });
    expect(canaisGravados()).toEqual(["meta"]);
    expect(mocks.conversationUpdate).toHaveBeenCalledWith({
      where: { id: "conv-1" },
      data: { whatsappProvider: "meta" },
    });
    // Sai pelo número em que a mensagem chegou, não por "o da conta".
    expect(sendMessage).toHaveBeenCalledWith("numero-1", "5511999999999", "Claro! Qual dia fica bom?");
  });

  it("mensagem pelo QR de uma conversa sem canal: fica registrada como do QR", async () => {
    conversa(null);

    await processIncomingWhatsapp(BASE, fakeProvider("evolution"));

    expect(canaisGravados()).toEqual(["evolution"]);
  });

  it("já era desse número: não escreve no banco a cada mensagem", async () => {
    conversa("meta");

    await processIncomingWhatsapp(BASE, fakeProvider("meta"));

    expect(canaisGravados()).toEqual([]);
  });

  it("o contato passou a escrever pelo outro número: o canal acompanha a última mensagem", async () => {
    conversa("meta");

    await processIncomingWhatsapp(BASE, fakeProvider("evolution"));

    expect(canaisGravados()).toEqual(["evolution"]);
  });

  it("a instância é procurada pelo provedor que recebeu — o mesmo id em provedores diferentes não se confunde", async () => {
    await processIncomingWhatsapp(BASE, fakeProvider("meta"));

    expect(mocks.instanceFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { externalId: "numero-1", provider: "meta" } }),
    );
  });

  it("eco da própria resposta (mesmo id) não mexe no canal", async () => {
    conversa("meta");
    mocks.messageFindUnique.mockResolvedValue({ id: "ja-gravada" });

    await processIncomingWhatsapp({ ...BASE, isFromMe: true }, fakeProvider("evolution"));

    expect(canaisGravados()).toEqual([]);
  });

  it("eco por texto recente (sem id conhecido) também não mexe no canal", async () => {
    conversa("meta");
    mocks.messageFindFirst.mockResolvedValue({ id: "resposta-do-agente" });

    await processIncomingWhatsapp({ ...BASE, isFromMe: true, messageKeyId: undefined }, fakeProvider("evolution"));

    expect(canaisGravados()).toEqual([]);
  });

  it("atendente escrevendo pelo próprio celular assume a conversa nesse número", async () => {
    conversa(null);

    const result = await processIncomingWhatsapp({ ...BASE, isFromMe: true }, fakeProvider("evolution"));

    expect(result.body).toMatchObject({ silent: "manual pelo whatsapp" });
    expect(canaisGravados()).toEqual(["evolution"]);
  });

  it("falha ao anotar o canal não derruba a resposta ao cliente", async () => {
    conversa("evolution");
    mocks.conversationUpdate.mockRejectedValue(new Error("banco fora do ar"));

    const result = await processIncomingWhatsapp(BASE, fakeProvider("meta"));

    expect(result.body).toEqual({ ok: true });
    expect(sendMessage).toHaveBeenCalledOnce();
  });

  it("provedor desconhecido não grava canal nenhum", async () => {
    conversa(null);

    await processIncomingWhatsapp(BASE, fakeProvider("widget"));

    expect(canaisGravados()).toEqual([]);
  });
});
