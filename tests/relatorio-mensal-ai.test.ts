import { beforeEach, describe, expect, it, vi } from "vitest";
const ai = vi.hoisted(() => ({ chain: vi.fn(), secret: vi.fn(), provider: vi.fn(), usage: vi.fn() }));
vi.mock("@/modules/ai", async () => {
  const types = await import("@/modules/ai/types");
  return { ...types, getUsableChain: ai.chain, resolveSecret: ai.secret, createProvider: ai.provider };
});
vi.mock("@/modules/ai/usage", () => ({ recordUsage: ai.usage }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { AiError } from "@/modules/ai/types";
import { applyMonthlyAiChanges, monthlyAiDraftSchema, monthlyAiResponseSchema, parseMonthlyAiResponse, type MonthlyAiDraft } from "@/modules/reports/monthly-ai";
import { answerMonthlyAi, monthlyAiMessages } from "@/modules/reports/monthly-ai-service";
import { roiFixture } from "./fixtures/monthly-roi";

const draft = (): MonthlyAiDraft => {
  const report = roiFixture();
  return { assumptions: report.assumptions, metricOverrides: { current: { handoffs: 7, conversations: { inside: 11 } }, previous: {} }, adjustments: "Ajuste conferido", nextMonth: "Texto manual", decisionMaker: "Decisor", highlights: "", limitationsNote: "", nextActions: [] };
};
beforeEach(() => { vi.resetAllMocks(); ai.secret.mockResolvedValue("server-secret"); ai.usage.mockResolvedValue(undefined); });

describe("preenchimentos sugeridos pela IA", () => {
  it("mescla dinheiro, procedimentos e indicadores preservando valores e textos não sugeridos", () => {
    const original = draft();
    const result = applyMonthlyAiChanges(original, [
      { field: "assumptions.attendantMonthlyCents", value: 250000, reason: "Informado pelo administrador" },
      { field: "assumptions.procedures", value: [{ name: "implante", conversionBps: 3000 }, { name: "Ortodontia", ticketCents: 800000 }], reason: "Valores informados" },
      { field: "current.conversations.outside", value: 22, reason: "Correção informada" },
      { field: "nextMonth", value: "Conferir presença com a recepção.", reason: "Proposta de acompanhamento" },
    ]);
    expect(result.assumptions.attendantMonthlyCents).toBe(250000);
    expect(result.assumptions.procedures).toEqual([{ name: "implante", ticketCents: 100000, conversionBps: 3000 }, { name: "Ortodontia", ticketCents: 800000, conversionBps: null }]);
    expect(result.metricOverrides.current).toEqual({ handoffs: 7, conversations: { inside: 11, outside: 22 } });
    expect(result.adjustments).toBe("Ajuste conferido"); expect(result.decisionMaker).toBe("Decisor");
    expect(original.assumptions.attendantMonthlyCents).toBe(220000); expect(original.nextMonth).toBe("Texto manual");
  });
  it.each(["current.roiPercent", "assumptions.agentIds", "assumptions.completedStatusTypes", "assumptions.countUntypedAsEvaluations", "status", "__proto__"])("recusa alteração fora dos campos editáveis: %s", (field) => {
    expect(monthlyAiResponseSchema.safeParse({ reply: "Resposta", changes: [{ field, value: 1, reason: "Pedido" }] }).success).toBe(false);
  });
  it("recusa números impossíveis, campos duplicados, intervalos sobrepostos e texto que não cabe no PDF", () => {
    for (const changes of [
      [{ field: "assumptions.procedures", value: [{ name: "Implante", conversionBps: 10001 }], reason: "Pedido" }],
      [{ field: "current.newContacts", value: -1, reason: "Pedido" }],
      [{ field: "nextMonth", value: "x".repeat(401), reason: "Pedido" }],
      [{ field: "assumptions.humanHours", value: [[], [{ start: 540, end: 720 }, { start: 600, end: 800 }], [], [], [], [], []], reason: "Pedido" }],
      [{ field: "decisionMaker", value: "A", reason: "Pedido" }, { field: "decisionMaker", value: "B", reason: "Pedido" }],
    ]) expect(monthlyAiResponseSchema.safeParse({ reply: "Resposta", changes }).success).toBe(false);
  });
  it("valida o resultado agregado: não permite ultrapassar 12 procedimentos ao acrescentar sugestões", () => {
    const original = draft(); original.assumptions.procedures = Array.from({ length: 12 }, (_, i) => ({ name: `P${i}`, ticketCents: null, conversionBps: null }));
    expect(() => applyMonthlyAiChanges(original, [{ field: "assumptions.procedures", value: [{ name: "Novo", ticketCents: 100 }], reason: "Pedido" }])).toThrow();
    expect(original.assumptions.procedures).toHaveLength(12);
  });
  it("aceita JSON cercado pelo provedor, explicações sem preenchimento e rejeita texto livre inválido", () => {
    expect(parseMonthlyAiResponse('```json\n{"reply":"Conversão é a proporção de avaliações que viram tratamento.","changes":[]}\n```').changes).toEqual([]);
    expect(() => parseMonthlyAiResponse("Preenchi tudo!")).toThrow();
    expect(monthlyAiDraftSchema.safeParse({ ...draft(), adjustments: "x".repeat(401) }).success).toBe(false);
  });
});

describe("contexto e provedor do assistente", () => {
  it("envia somente agregados e revisão atual, sem conversas, IDs de pacientes ou credenciais", () => {
    const report = Object.assign(roiFixture(), { conversations: [{ phone: "telefone-privado", content: "mensagem-privada" }], credential: "chave-privada", clinicorpError: "erro-com-segredo" });
    const current = draft(); current.assumptions.attendantMonthlyCents = 330000;
    const messages = monthlyAiMessages(report, { question: "O que falta?", history: [], draft: current }, []);
    const text = JSON.stringify(messages);
    expect(text).toContain("330000"); expect(text).toContain("PRIMEIRA chegada"); expect(text).toContain("basis points");
    for (const privateText of ["telefone-privado", "mensagem-privada", "chave-privada", "erro-com-segredo"]) expect(text).not.toContain(privateText);
  });
  it("usa credencial da cadeia configurada e passa ao próximo provedor quando houver falha", async () => {
    ai.chain.mockResolvedValue([{ model: { id: "m1", label: "Modelo 1", provider: "gemini" }, credentialId: "cred-1" }, { model: { id: "m2", label: "Modelo 2", provider: "custom" }, credentialId: "cred-2" }]);
    const usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };
    ai.provider.mockReturnValueOnce({ isConfigured: () => true, complete: vi.fn().mockRejectedValue(new AiError("rate_limit", "erro privado", { provider: "gemini", model: "m1" })) })
      .mockReturnValueOnce({ isConfigured: () => true, provider: "custom", complete: vi.fn().mockResolvedValue({ content: '{"reply":"Expliquei o campo.","changes":[]}', usage }) });
    const response = await answerMonthlyAi([{ role: "user", content: "Ajude" }], draft());
    expect(response.providerLabel).toBe("Modelo 2"); expect(response.reply).toBe("Expliquei o campo.");
    expect(ai.secret.mock.calls).toEqual([["gemini", "cred-1"], ["custom", "cred-2"]]);
    expect(ai.provider.mock.calls[1][1]).toBe("server-secret"); expect(JSON.stringify(response)).not.toContain("server-secret");
    expect(ai.usage).toHaveBeenCalledWith("custom", usage);
  });
  it("sem chave devolve erro de configuração, nunca uma resposta de demonstração", async () => {
    ai.chain.mockResolvedValue([{ model: { label: "Modelo", provider: "gemini" }, credentialId: null }]);
    const complete = vi.fn(); ai.provider.mockReturnValue({ isConfigured: () => false, complete });
    await expect(answerMonthlyAi([], draft())).rejects.toThrow("Nenhum provedor"); expect(complete).not.toHaveBeenCalled();
  });
  it("não entrega propostas inválidas ou mensagens de erro privadas do provedor", async () => {
    ai.chain.mockResolvedValue([{ model: { provider: "custom" }, credentialId: null }]);
    ai.provider.mockReturnValue({ isConfigured: () => true, complete: vi.fn().mockResolvedValue({ content: '{"reply":"Retorno","changes":[{"field":"current.roiPercent","value":999,"reason":"Inventado"}]}' }) });
    await expect(answerMonthlyAi([], draft())).rejects.toThrow("resposta válida");
    ai.provider.mockReturnValue({ isConfigured: () => true, complete: vi.fn().mockRejectedValue(new Error("API key segredo")) });
    await expect(answerMonthlyAi([], draft())).rejects.toThrow("Não foi possível consultar");
  });
});
