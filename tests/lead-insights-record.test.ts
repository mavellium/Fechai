import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  conversation: { findFirst: vi.fn() },
  conversationInsight: { upsert: vi.fn(), updateMany: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/modules/knowledge-gaps/register", () => ({ registerKnowledgeGap: vi.fn() }));
vi.mock("@/modules/reports/events", () => ({ recordReportEvent: vi.fn() }));

import { recordLeadInsight, scrubInsightText } from "@/modules/lead-insights/record";
import { LEAD_INSIGHT_TOOL, leadInsightRule, leadInsightToolResult, leadInsightToolSchema } from "@/modules/lead-insights/tool";
import { getToolSchemas, runToolHandler } from "@/modules/agent-engine/tools";

const BASE = { tenantId: "t1", conversationId: "c1" };
const real = { id: "c1", isTest: false, lead: { isTest: false } };

beforeEach(() => {
  vi.clearAllMocks();
  db.conversation.findFirst.mockResolvedValue(real);
  db.conversationInsight.upsert.mockResolvedValue({});
  db.conversationInsight.updateMany.mockResolvedValue({ count: 1 });
});

describe("recordLeadInsight", () => {
  it("grava cidade, dúvida e motivo, com a chave da cidade normalizada", async () => {
    const out = await recordLeadInsight({
      ...BASE, city: "Marília - SP", procedure: "implante",
      firstQuestionCategory: "localizacao", firstQuestionText: "Vocês são em Marília?",
      lossReasonCategory: "fora_da_regiao", lossReasonText: "queria em Marília",
    });
    expect(out).toEqual({ status: "saved", fields: ["city", "procedure", "firstQuestion", "lossReason"] });
    expect(db.conversation.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "c1", tenantId: "t1" } }));
    const call = db.conversationInsight.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ conversationId: "c1" });
    expect(call.update).toEqual({ city: "Marília - SP", cityKey: "marilia", procedure: "implante", lossReasonKey: "fora_da_regiao", lossReasonText: "queria em Marília" });
    expect(call.create).toMatchObject({ tenantId: "t1", conversationId: "c1", cityKey: "marilia", firstQuestionKey: "localizacao" });
  });

  it("a primeira dúvida só preenche se ainda estiver vazia", async () => {
    await recordLeadInsight({ ...BASE, firstQuestionCategory: "preco", firstQuestionText: "Quanto custa?" });
    expect(db.conversationInsight.updateMany).toHaveBeenCalledWith({
      where: { conversationId: "c1", tenantId: "t1", firstQuestionKey: null },
      data: { firstQuestionKey: "preco", firstQuestionText: "Quanto custa?" },
    });
    // Nas chamadas seguintes o `update` do upsert nunca carrega a dúvida.
    expect(db.conversationInsight.upsert.mock.calls[0][0].update).toEqual({});
  });

  it("categoria desconhecida vira outro; texto sem categoria também", async () => {
    await recordLeadInsight({ ...BASE, firstQuestionCategory: "inventada", lossReasonText: "achou a clínica longe" });
    const { create } = db.conversationInsight.upsert.mock.calls[0][0];
    expect(create.firstQuestionKey).toBe("outro");
    expect(create.lossReasonKey).toBe("outro");
  });

  it("não grava cidade que não parece cidade", async () => {
    expect(await recordLeadInsight({ ...BASE, city: "moro em marília e queria saber o valor da consulta de vocês pra semana" })).toEqual({ status: "empty", fields: [] });
    expect(db.conversationInsight.upsert).not.toHaveBeenCalled();
  });

  it("conversa de teste e lead de teste ficam fora", async () => {
    db.conversation.findFirst.mockResolvedValueOnce({ ...real, isTest: true });
    expect((await recordLeadInsight({ ...BASE, city: "Garça" })).status).toBe("test");
    db.conversation.findFirst.mockResolvedValueOnce({ ...real, lead: { isTest: true } });
    expect((await recordLeadInsight({ ...BASE, city: "Garça" })).status).toBe("test");
    expect(db.conversationInsight.upsert).not.toHaveBeenCalled();
  });

  it("conversa de outro tenant não é encontrada, e nada é gravado", async () => {
    db.conversation.findFirst.mockResolvedValueOnce(null);
    expect((await recordLeadInsight({ ...BASE, city: "Garça" })).status).toBe("failed");
    expect(db.conversationInsight.upsert).not.toHaveBeenCalled();
  });

  it("nunca lança: falha do banco vira failed", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    db.conversationInsight.upsert.mockRejectedValueOnce(new Error("db fora do ar"));
    await expect(recordLeadInsight({ ...BASE, city: "Garça" })).resolves.toEqual({ status: "failed", fields: [] });
    spy.mockRestore();
  });

  it("retenta uma vez quando dois registros criam a linha ao mesmo tempo", async () => {
    const { Prisma } = await import("@prisma/client");
    db.conversationInsight.upsert.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "test" }));
    expect((await recordLeadInsight({ ...BASE, city: "Garça" })).status).toBe("saved");
    expect(db.conversationInsight.upsert).toHaveBeenCalledTimes(2);
  });
});

describe("texto do registro", () => {
  it("tira e-mail e telefone e limita o tamanho", () => {
    expect(scrubInsightText("Meu e-mail é ana@x.com e o zap (14) 99999-8888, quanto custa?")).toBe("Meu e-mail é e o zap , quanto custa?");
    expect(scrubInsightText("   ")).toBeNull();
    expect(scrubInsightText(42)).toBeNull();
    expect(scrubInsightText("a".repeat(500))!.length).toBeLessThanOrEqual(200);
  });
});

describe("tool record_lead_insight", () => {
  it("vale para todo agente, sem vaga de habilidade, e não para chamada sem agente", () => {
    expect(getToolSchemas([], undefined, []).some((s) => s.name === LEAD_INSIGHT_TOOL)).toBe(true);
    expect(getToolSchemas([], undefined, undefined).some((s) => s.name === LEAD_INSIGHT_TOOL)).toBe(false);
  });

  it("oferece só categorias do agente (sem 'sumiu', que é derivado) e nenhum campo obrigatório", () => {
    const props = leadInsightToolSchema.parameters.properties as Record<string, { enum?: string[] }>;
    expect(props.first_question_category.enum).toContain("localizacao");
    expect(props.loss_reason_category.enum).toContain("fora_da_regiao");
    expect(props.loss_reason_category.enum).not.toContain("sumiu");
    expect((leadInsightToolSchema.parameters as { required?: string[] }).required).toBeUndefined();
  });

  it("o handler grava pelo contexto do turno e responde sem mudar a conversa", async () => {
    const out = await runToolHandler(LEAD_INSIGHT_TOOL, { tenantId: "t1", leadId: "l1", conversationId: "c1", agentId: "a1" }, { city: "Marília", first_question_category: "localizacao" });
    expect(out).toContain("Registrado");
    expect(out).toContain("normalmente");
    expect(db.conversationInsight.upsert.mock.calls[0][0].create).toMatchObject({ tenantId: "t1", conversationId: "c1", cityKey: "marilia" });
  });

  it("o resultado nunca pede para reagir ao raio ou à cidade", () => {
    for (const status of ["saved", "empty", "test", "failed"] as const) {
      const text = leadInsightToolResult({ status, fields: [] });
      expect(text).not.toMatch(/fora do raio|desqualific|transfer/i);
    }
    expect(leadInsightRule()).toContain(LEAD_INSIGHT_TOOL);
    expect(leadInsightRule()).toMatch(/n[ãa]o deduza/i);
  });
});
