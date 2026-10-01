import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(), rate: vi.fn(), size: vi.fn(), compute: vi.fn(), answer: vi.fn(), messages: vi.fn(), analysis: vi.fn(),
  db: { tenant: { findUnique: vi.fn() }, agent: { findMany: vi.fn(), count: vi.fn() }, auditLog: { findMany: vi.fn() }, monthlyRoiReport: { findUnique: vi.fn(), updateMany: vi.fn(), create: vi.fn() }, message: { create: vi.fn() } },
}));
vi.mock("@/lib/session", () => ({ requireSuperadmin: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.db }));
vi.mock("@/lib/rate-limit", () => ({ payloadTooLarge: mocks.size, rateLimit: mocks.rate }));
vi.mock("@/modules/reports/monthly", async (importOriginal) => ({ ...await importOriginal<typeof import("@/modules/reports/monthly")>(), computeMonthlyReport: mocks.compute }));
vi.mock("@/modules/reports/monthly-ai-service", () => ({ answerMonthlyAi: mocks.answer, monthlyAiMessages: mocks.messages, draftMonthlyAnalysis: mocks.analysis }));
import { assistMonthlyRoi, generateMonthlyRoiAnalysis } from "@/app/(admin)/admin/relatorios/[tenantId]/ai-actions";
import { roiFixture } from "./fixtures/monthly-roi";
function form(ids: string[] = []) {
  const report = roiFixture(); const form = new FormData();
  form.set("request", JSON.stringify({ question: "Ajude a preencher", history: [], draft: { assumptions: { ...report.assumptions, agentIds: ids }, metricOverrides: { current: {}, previous: {} }, adjustments: "", nextMonth: "", decisionMaker: "" } }));
  return form;
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.auth.mockResolvedValue({ user: { id: "admin" } }); mocks.size.mockReturnValue(null); mocks.rate.mockResolvedValue({ allowed: true });
  mocks.db.tenant.findUnique.mockResolvedValue({ id: "own" }); mocks.db.agent.findMany.mockResolvedValue([{ id: "a", name: "A", isPrimary: true, archived: false, actions: [] }]);
  mocks.db.monthlyRoiReport.findUnique.mockResolvedValue(null); mocks.compute.mockResolvedValue(roiFixture()); mocks.messages.mockReturnValue([]);
  mocks.answer.mockResolvedValue({ reply: "Faltam premissas", changes: [], providerLabel: "Modelo", consulted: [] });
});
describe("autorização e isolamento do assistente de ROI", () => {
  it("exige SUPERADMIN antes de banco e provedor", async () => {
    mocks.auth.mockRejectedValue(new Error("Forbidden"));
    await expect(assistMonthlyRoi("foreign", "2026-09", form())).rejects.toThrow("Forbidden");
    expect(mocks.db.tenant.findUnique).not.toHaveBeenCalled(); expect(mocks.answer).not.toHaveBeenCalled();
  });
  it("bloqueia seleção de outro cliente, mês inválido, payload extenso, revisão fechada e excesso de chamadas", async () => {
    expect((await assistMonthlyRoi("own", "invalid", form())).ok).toBe(false);
    mocks.size.mockReturnValueOnce("Muito grande"); expect((await assistMonthlyRoi("own", "2026-09", form())).ok).toBe(false);
    mocks.db.agent.findMany.mockResolvedValueOnce([]); expect((await assistMonthlyRoi("own", "2026-09", form(["foreign"]))).ok).toBe(false);
    mocks.db.monthlyRoiReport.findUnique.mockResolvedValueOnce({ status: "ready" }); expect((await assistMonthlyRoi("own", "2026-09", form())).ok).toBe(false);
    mocks.rate.mockResolvedValueOnce({ allowed: false }); expect((await assistMonthlyRoi("own", "2026-09", form())).ok).toBe(false);
    expect(mocks.answer).not.toHaveBeenCalled();
  });
  it("usa somente agentes do tenant e a revisão não salva; não grava relatório ou mensagem de atendimento", async () => {
    const result = await assistMonthlyRoi("own", "2026-09", form(["a"]));
    expect(result.ok).toBe(true);
    expect(mocks.db.agent.findMany.mock.calls[0][0].where).toEqual({ tenantId: "own", id: { in: ["a"] } });
    expect(mocks.compute.mock.calls[0].slice(0, 3)).toEqual(["own", "2026-09", false]);
    // O assistente recebe as ferramentas de leitura deste relatório.
    const toolbox = mocks.answer.mock.calls[0][2];
    expect(toolbox.tools.map((t: { name: string }) => t.name)).toEqual(["list_appointments", "list_conversations", "list_events", "get_conversation", "get_configuration", "get_integrations"]);
    expect(mocks.db.monthlyRoiReport.updateMany).not.toHaveBeenCalled(); expect(mocks.db.monthlyRoiReport.create).not.toHaveBeenCalled(); expect(mocks.db.message.create).not.toHaveBeenCalled();
  });
  it("limita histórico e não expõe segredo ou detalhes do provedor quando falha", async () => {
    const oversized = form(); const data = JSON.parse(String(oversized.get("request"))); data.history = Array.from({ length: 13 }, () => ({ role: "user", content: "Pergunta" }));
    oversized.set("request", JSON.stringify(data)); expect((await assistMonthlyRoi("own", "2026-09", oversized)).ok).toBe(false);
    mocks.answer.mockRejectedValue(new Error("Erro no token secreto"));
    const result = await assistMonthlyRoi("own", "2026-09", form()); expect(result).toEqual({ ok: false, error: "Não foi possível consultar a IA. Tente novamente." });
  });
});

describe("análise do mês (etapa 4)", () => {
  const request = (ids: string[] = [], context = "") => {
    const report = roiFixture(); const data = new FormData();
    data.set("request", JSON.stringify({ context, draft: { assumptions: { ...report.assumptions, agentIds: ids }, metricOverrides: { current: {}, previous: {} }, adjustments: "", nextMonth: "", decisionMaker: "", highlights: "", limitationsNote: "" } }));
    return data;
  };
  it("aponta o campo e a etapa quando a revisão é inválida, sem chamar a IA", async () => {
    const form = request(); const raw = JSON.parse(String(form.get("request")));
    raw.draft.assumptions.evaluationTypes = [];
    form.set("request", JSON.stringify(raw));
    expect(await generateMonthlyRoiAnalysis("own", "2026-09", form)).toEqual({ ok: false, error: "Confira: Tipos de atendimento considerados avaliações (etapa 2)." });
    expect(mocks.analysis).not.toHaveBeenCalled(); expect(mocks.compute).not.toHaveBeenCalled();
  });
  it("gera rascunho com decisor, ajustes e plano vazios: são preenchidos antes de fechar", async () => {
    expect((await generateMonthlyRoiAnalysis("own", "2026-09", request())).ok).toBe(true);
    expect(mocks.analysis).toHaveBeenCalledOnce();
  });
  beforeEach(() => {
    mocks.db.agent.count.mockResolvedValue(1);
    mocks.analysis.mockResolvedValue({ highlights: "H", limitationsNote: "", adjustments: "", nextMonth: "N", notes: "", providerLabel: "Modelo" });
    mocks.db.auditLog.findMany.mockResolvedValue([
      // Do mais recente ao mais antigo, como a consulta ordena.
      { event: "knowledge.gap_answered", targetType: "KnowledgeGap", targetId: "g", targetLabel: "Sou a Maria, quanto custa?", createdAt: new Date("2026-09-13T12:00:00Z") },
      { event: "agent.persona_updated", targetType: "Agent", targetId: "b", targetLabel: "Agente de outro escopo", createdAt: new Date("2026-09-12T12:00:00Z") },
      { event: "agent.rules_updated", targetType: "Agent", targetId: "a", targetLabel: "Agente A", createdAt: new Date("2026-09-11T12:00:00Z") },
      { event: "agent.rules_updated", targetType: "Agent", targetId: "a", targetLabel: "Agente A", createdAt: new Date("2026-09-10T12:00:00Z") },
    ]);
  });
  it("manda à IA as alterações do mês, só no escopo, sem a pergunta do contato", async () => {
    const result = await generateMonthlyRoiAnalysis("own", "2026-09", request(["a"]));
    expect(result.ok).toBe(true);
    expect(mocks.db.auditLog.findMany.mock.calls[0][0].where).toMatchObject({ tenantId: "own", createdAt: { gte: new Date("2026-09-01T03:00:00Z"), lt: new Date("2026-10-01T03:00:00Z") } });
    const [messages, guard] = mocks.analysis.mock.calls[0];
    const facts = JSON.parse(String(messages[0].content).split("FATOS: ")[1]);
    expect(facts.agentChanges).toEqual([
      { label: "Aprovou a resposta de uma pergunta sem resposta", target: null, count: 1, lastAt: "2026-09-13T12:00:00.000Z" },
      { label: "Alterou as regras do agente", target: "Agente A", count: 2, lastAt: "2026-09-11T12:00:00.000Z" },
    ]);
    expect(JSON.stringify(messages)).not.toContain("Maria");
    expect(guard.hasFacts).toBe(true);
    expect(mocks.db.monthlyRoiReport.updateMany).not.toHaveBeenCalled(); expect(mocks.db.monthlyRoiReport.create).not.toHaveBeenCalled();
  });
  it("sem alteração, nota ou texto, avisa a trava de que melhoria não é inventada", async () => {
    mocks.db.auditLog.findMany.mockResolvedValue([]);
    await generateMonthlyRoiAnalysis("own", "2026-09", request());
    expect(mocks.analysis.mock.calls[0][1].hasFacts).toBe(false);
    await generateMonthlyRoiAnalysis("own", "2026-09", request([], "Revisamos o tom"));
    expect(mocks.analysis.mock.calls[1][1].hasFacts).toBe(true);
  });
  it("recusa revisão fechada, agente de outro cliente e excesso de chamadas antes da IA", async () => {
    mocks.db.monthlyRoiReport.findUnique.mockResolvedValueOnce({ status: "ready" }); expect((await generateMonthlyRoiAnalysis("own", "2026-09", request())).ok).toBe(false);
    mocks.db.agent.count.mockResolvedValueOnce(0); expect((await generateMonthlyRoiAnalysis("own", "2026-09", request(["foreign"]))).ok).toBe(false);
    mocks.rate.mockResolvedValueOnce({ allowed: false }); expect((await generateMonthlyRoiAnalysis("own", "2026-09", request())).ok).toBe(false);
    expect(mocks.analysis).not.toHaveBeenCalled();
  });
});
