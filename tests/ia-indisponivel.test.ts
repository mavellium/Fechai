import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Teste da regra "provedor de IA fora do ar não quebra a tela".
 *
 * Quando NENHUM degrau da cadeia responde — cadeia vazia (ninguém cadastrou
 * provedor em /admin/ia) ou todos sem credencial — o turno acabava lançando um
 * `Error` cru. Como `runAgentTurn` é chamado de dentro do render do Server
 * Component de /conversas, esse erro subia até a página e derrubava o layout
 * inteiro: o dono da conta perdia a caixa de entrada por causa de uma chave de
 * API faltando.
 *
 * O contrato protegido aqui: falta de provedor é `AiError` de configuração,
 * tratada como qualquer outra indisponibilidade — a conversa continua de pé,
 * o lead recebe uma mensagem clara, a conversa sobe para humano e o motivo
 * aparece no console.
 */

const db = vi.hoisted(() => ({
  conversation: {
    findUnique: vi.fn(async () => ({ agentPaused: false })),
    update: vi.fn(async () => ({})),
    updateMany: vi.fn(async () => ({})),
  },
  agent: { findFirst: vi.fn() },
  tenantAction: { findMany: vi.fn(async () => []) },
}));
const conversation = vi.hoisted(() => ({
  appendMessage: vi.fn(async () => ({ id: "msg-1" })),
  getRecentMessages: vi.fn(async () => []),
}));
/** A cadeia é montada por teste: vazia, ou com degraus sem credencial. */
const chain = vi.hoisted(() => ({ steps: [] as unknown[], configured: false }));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/modules/billing/usage", () => ({
  getUsageSummary: vi.fn(async () => ({ atLimit: false })),
}));
vi.mock("@/modules/agent-engine/conversation", () => conversation);
vi.mock("@/modules/knowledge-base/embeddings", () => ({ embedQuery: vi.fn(async () => null) }));
vi.mock("@/modules/knowledge-base/repository", () => ({
  searchSimilarChunks: vi.fn(async () => []),
}));
vi.mock("@/modules/ai/usage", () => ({ recordUsage: vi.fn(async () => {}) }));

// `AiError`/`isAiError` são os DE VERDADE: é exatamente o reconhecimento do
// erro que está sob teste — um fake de `isAiError` esconderia a regressão.
vi.mock("@/modules/ai", async () => {
  const real = await vi.importActual<typeof import("@/modules/ai/types")>("@/modules/ai/types");
  return {
    AiError: real.AiError,
    isAiError: real.isAiError,
    createProvider: () => ({
      provider: "fake",
      model: "fake-1",
      isConfigured: () => chain.configured,
      complete: vi.fn(async () => ({ content: "nunca chega aqui", toolCalls: [], usage: {} })),
    }),
    getUsableChain: async () => chain.steps,
    resolveSecret: async () => undefined,
    markCredentialOk: vi.fn(),
    markCredentialCooldown: vi.fn(),
    getCooldownMinutes: () => 5,
  };
});

import { runAgentTurn } from "@/modules/agent-engine/orchestrator";

function turno() {
  return runAgentTurn({
    tenantId: "tenant-1",
    conversationId: "conversa-1",
    leadId: "lead-1",
    userMessage: "oi",
    skipUsageCheck: true,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  db.conversation.findUnique.mockResolvedValue({ agentPaused: false });
  db.tenantAction.findMany.mockResolvedValue([]);
  conversation.appendMessage.mockResolvedValue({ id: "msg-1" });
  conversation.getRecentMessages.mockResolvedValue([]);
  db.agent.findFirst.mockResolvedValue({
    id: "agente-1",
    systemPrompt: "Você atende a clínica.",
    enabled: true,
    listenAudio: true,
    stopOnEmoji: true,
    speakReplies: false,
    voiceId: null,
    voiceStyle: "neutra",
    speechBlocklist: "",
  });
});

describe("nenhum provedor de IA disponível", () => {
  it("não lança quando a cadeia está vazia", async () => {
    chain.steps = [];

    const r = await turno();

    // O que quebrava a página: este `await` rejeitava.
    expect(r.status).toBe("ok");
    expect(r.reply).not.toBe("");
  });

  it("escala para humano em vez de morrer em silêncio", async () => {
    chain.steps = [];

    await turno();

    expect(db.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { needsHuman: true } }),
    );
  });

  it("registra o motivo no console", async () => {
    chain.steps = [];

    await turno();

    expect(console.error).toHaveBeenCalled();
  });

  it("pula degrau sem credencial em vez de tratá-lo como falha de rede", async () => {
    chain.steps = [
      { model: { provider: "fake", id: "fake-1" }, credentialId: null, credentialLabel: null },
    ];
    chain.configured = false;

    const r = await turno();

    expect(r.status).toBe("ok");
    expect(r.reply).not.toBe("");
  });
});
