import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(), rate: vi.fn(), size: vi.fn(), compute: vi.fn(), answer: vi.fn(), messages: vi.fn(),
  db: { tenant: { findUnique: vi.fn() }, agent: { findMany: vi.fn() }, monthlyRoiReport: { findUnique: vi.fn(), updateMany: vi.fn(), create: vi.fn() }, message: { create: vi.fn() } },
}));
vi.mock("@/lib/session", () => ({ requireSuperadmin: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.db }));
vi.mock("@/lib/rate-limit", () => ({ payloadTooLarge: mocks.size, rateLimit: mocks.rate }));
vi.mock("@/modules/reports/monthly", async (importOriginal) => ({ ...await importOriginal<typeof import("@/modules/reports/monthly")>(), computeMonthlyReport: mocks.compute }));
vi.mock("@/modules/reports/monthly-ai-service", () => ({ answerMonthlyAi: mocks.answer, monthlyAiMessages: mocks.messages }));
import { assistMonthlyRoi } from "@/app/(admin)/admin/relatorios/[tenantId]/ai-actions";
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
  mocks.answer.mockResolvedValue({ reply: "Faltam premissas", changes: [], providerLabel: "Modelo" });
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
    expect(mocks.db.monthlyRoiReport.updateMany).not.toHaveBeenCalled(); expect(mocks.db.monthlyRoiReport.create).not.toHaveBeenCalled(); expect(mocks.db.message.create).not.toHaveBeenCalled();
  });
  it("limita histórico e não expõe segredo ou detalhes do provedor quando falha", async () => {
    const oversized = form(); const data = JSON.parse(String(oversized.get("request"))); data.history = Array.from({ length: 13 }, () => ({ role: "user", content: "Pergunta" }));
    oversized.set("request", JSON.stringify(data)); expect((await assistMonthlyRoi("own", "2026-09", oversized)).ok).toBe(false);
    mocks.answer.mockRejectedValue(new Error("Erro no token secreto"));
    const result = await assistMonthlyRoi("own", "2026-09", form()); expect(result).toEqual({ ok: false, error: "Não foi possível consultar a IA. Tente novamente." });
  });
});
