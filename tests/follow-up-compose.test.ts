import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Follow-up escrito pela IA (`modules/follow-up/compose.ts`). A regra que
 * importa: a IA é opcional — sem cota, fora do ar ou devolvendo vazio, a
 * mensagem de referência sai assim mesmo, e a chamada paga nem acontece
 * quando a conta já está no limite.
 */

const db = vi.hoisted(() => ({ message: { findMany: vi.fn() } }));
const usage = vi.hoisted(() => ({ getUsageSummary: vi.fn() }));
const llm = vi.hoisted(() => ({ completeBackgroundText: vi.fn() }));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/modules/billing/usage", () => usage);
vi.mock("@/modules/agent-engine/summary", () => llm);
vi.mock("@/modules/ai", () => ({
  isAiError: (err: unknown) => err instanceof Error && err.name === "AiError",
}));

import { composeFollowUp } from "@/modules/follow-up/compose";

const input = {
  tenantId: "tenant-1",
  conversationId: "conversa-1",
  systemPrompt: "Você é a Ana, da Clínica Sorriso.",
  reference: "Oi, Maria! Ficou alguma dúvida?",
  values: { nome: "Maria" },
};

beforeEach(() => {
  vi.clearAllMocks();
  usage.getUsageSummary.mockResolvedValue({ atLimit: false });
  db.message.findMany.mockResolvedValue([
    { role: "assistant", content: "Tenho quinta às 15h ou sexta às 10h." },
    { role: "user", content: "Quanto custa a limpeza?" },
  ]);
});

describe("composeFollowUp", () => {
  it("sem cota, manda a referência sem chamar a IA", async () => {
    usage.getUsageSummary.mockResolvedValue({ atLimit: true });

    await expect(composeFollowUp(input)).resolves.toEqual({ text: input.reference, byAi: false });
    expect(llm.completeBackgroundText).not.toHaveBeenCalled();
  });

  it("usa o texto da IA, sem aspas e sem variável crua", async () => {
    llm.completeBackgroundText.mockResolvedValue("“Maria, conseguiu ver os horários de quinta? {{endereco}}”");

    await expect(composeFollowUp(input)).resolves.toEqual({
      text: "Maria, conseguiu ver os horários de quinta?",
      byAi: true,
    });
  });

  it("manda a conversa em ordem cronológica, com a persona e a barreira de segurança", async () => {
    llm.completeBackgroundText.mockResolvedValue("Oi!");

    await composeFollowUp(input);

    const [messages] = llm.completeBackgroundText.mock.calls[0];
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("Você é a Ana");
    expect(messages[0].content).toContain("REGRAS DE SEGURANÇA");
    expect(messages[1].role).toBe("user");
    expect(messages[1].content.indexOf("Quanto custa")).toBeLessThan(messages[1].content.indexOf("Tenho quinta"));
    expect(messages[1].content).toContain(input.reference);
  });

  it("IA fora do ar ou resposta vazia caem na referência", async () => {
    const aiError = Object.assign(new Error("fora do ar"), { name: "AiError" });
    llm.completeBackgroundText.mockRejectedValueOnce(aiError);
    await expect(composeFollowUp(input)).resolves.toEqual({ text: input.reference, byAi: false });

    llm.completeBackgroundText.mockResolvedValueOnce("   ");
    await expect(composeFollowUp(input)).resolves.toEqual({ text: input.reference, byAi: false });
  });
});
