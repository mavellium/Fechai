import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({
  tenant: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
  agent: { findMany: vi.fn() },
  monthlyRoiReport: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  conversation: { findMany: vi.fn(), findFirst: vi.fn() },
  appointment: { findMany: vi.fn() },
  reportEvent: { findMany: vi.fn(), upsert: vi.fn() },
  message: { groupBy: vi.fn() }, $transaction: vi.fn(),
}));
const guards = vi.hoisted(() => ({ superadmin: vi.fn(), product: vi.fn(), tenant: vi.fn() }));
const integration = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/session", () => ({ requireSuperadmin: guards.superadmin, requireTenant: guards.tenant }));
vi.mock("@/lib/require-product", () => ({ requireProductAccess: guards.product }));
vi.mock("@/lib/rate-limit", () => ({ payloadTooLarge: () => null }));
vi.mock("@/modules/scheduling/clinicorp", () => ({ readClinicorpReport: integration }));
vi.mock("@/modules/audit/log", () => ({ recordAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { computeMonthlyReport } from "@/modules/reports/monthly";
import { recordReportEvent } from "@/modules/reports/events";
import { saveMonthlyRoi, finalizeMonthlyRoi, reopenMonthlyRoi, recordMonthlyDelivery, previewMonthlyRoiImport } from "@/app/(admin)/admin/relatorios/[tenantId]/actions";
import { GET as ownerPdf } from "@/app/(dashboard)/relatorios/mensal/pdf/route";
import { GET as adminPdf } from "@/app/(admin)/admin/relatorios/[tenantId]/pdf/route";
import { roiConfig, roiFixture, roiInput } from "./fixtures/monthly-roi";

beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
  guards.superadmin.mockResolvedValue({ user: { id: "admin" } });
  guards.product.mockResolvedValue({}); guards.tenant.mockResolvedValue({ tenantId: "own" });
  db.tenant.findUnique.mockResolvedValue({ id: "own", status: "active" });
  db.tenant.findUniqueOrThrow.mockResolvedValue({ name: "Clinic", createdAt: new Date("2026-08-01T03:00:00Z"), reportTrackingStartedAt: new Date("2026-09-01T03:00:00Z") });
  db.agent.findMany.mockResolvedValue([{ id: "a", name: "Agente A" }]);
  const input = roiInput();
  db.conversation.findMany.mockResolvedValue(input.conversations); db.appointment.findMany.mockResolvedValue(input.appointments);
  db.reportEvent.findMany.mockResolvedValue(input.events); db.message.groupBy.mockResolvedValue([{ conversationId: "outside", _min: { createdAt: input.conversations[0].firstInbound } }]);
  integration.mockResolvedValue(input.clinicorp); db.monthlyRoiReport.updateMany.mockResolvedValue({ count: 1 });
  db.monthlyRoiReport.findFirst.mockResolvedValue(null);
  db.$transaction.mockImplementation(async (fn) => fn(db));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("carregamento e importação por agente", () => {
  it("preenche mensalidade ausente com preço do tenant sem inventar expediente", async () => {
    db.tenant.findUniqueOrThrow.mockResolvedValue({ name: "Clinic", planKey: "STARTER", priceCentsOverride: 12345, createdAt: new Date("2026-09-01T03:00:00Z"), reportTrackingStartedAt: new Date("2026-09-01T03:00:00Z") });
    db.monthlyRoiReport.findUnique.mockResolvedValue(null);
    const report = await computeMonthlyReport("own", "2026-09");
    expect(report.assumptions.investmentCents).toBe(12345);
    expect(report.assumptions.humanHours).toBeNull(); expect(report.investmentSource).toBe("Preço negociado da conta");
  });
  it("recusa agente de outro tenant na importação e na gravação", async () => {
    db.agent.findMany.mockResolvedValue([]);
    const form = new FormData(); form.set("assumptions", JSON.stringify({ ...roiConfig(), agentIds: ["foreign"] }));
    expect((await previewMonthlyRoiImport("own", "2026-09", form)).ok).toBe(false);
    expect((await saveMonthlyRoi("own", "2026-09", null, form)).ok).toBe(false);
    expect(db.agent.findMany.mock.calls[0][0].where).toEqual({ tenantId: "own", id: { in: ["foreign"] } });
    expect(db.monthlyRoiReport.create).not.toHaveBeenCalled(); expect(db.monthlyRoiReport.updateMany).not.toHaveBeenCalled();
  });
  it("prévia recalcula a seleção sem gravar e preserva premissas do formulário", async () => {
    db.monthlyRoiReport.findUnique.mockResolvedValue(null);
    db.conversation.findMany.mockResolvedValue(roiInput().conversations.map((c) => ({ ...c, agentId: "a" })));
    const form = new FormData(); form.set("assumptions", JSON.stringify({ ...roiConfig(), agentIds: ["a"], investmentCents: 45678 }));
    const result = await previewMonthlyRoiImport("own", "2026-09", form);
    expect(result.ok).toBe(true);
    if (result.ok) { expect(result.report.current.newContacts).toBe(1); expect(result.report.assumptions.investmentCents).toBe(45678); expect(result.report.agentNames).toEqual(["Agente A"]); }
    expect(db.monthlyRoiReport.create).not.toHaveBeenCalled(); expect(db.monthlyRoiReport.updateMany).not.toHaveBeenCalled();
  });
  it("não usa snapshot de todos os agentes para comparar uma seleção menor", async () => {
    const previous = roiFixture(); previous.month = "2026-08"; previous.current.newContacts = 99;
    db.monthlyRoiReport.findUnique.mockImplementation(async ({ where }) => where.tenantId_month.month === "2026-09"
      ? { status: "draft", assumptions: { ...roiConfig(), agentIds: ["a"] } }
      : { status: "ready", assumptions: roiConfig(), snapshot: previous });
    const report = await computeMonthlyReport("own", "2026-09");
    expect(report.previous.newContacts).toBe(0); expect(report.previousAssumptions.agentIds).toEqual(["a"]);
  });
  it("não importa uma revisão fechada", async () => {
    db.monthlyRoiReport.findUnique.mockResolvedValue({ status: "ready" });
    const form = new FormData(); form.set("assumptions", JSON.stringify(roiConfig()));
    expect((await previewMonthlyRoiImport("own", "2026-09", form)).ok).toBe(false);
    expect(db.conversation.findMany).not.toHaveBeenCalled();
  });
});

describe("autorização e isolamento do relatório mensal", () => {
  it("recusa ações de revisão antes de qualquer acesso ao banco para não-admin", async () => {
    guards.superadmin.mockRejectedValue(new Error("Forbidden"));
    const form = new FormData(); form.set("assumptions", JSON.stringify(roiConfig()));
    for (const action of [() => saveMonthlyRoi("other", "2026-09", null, form), () => finalizeMonthlyRoi("other", "2026-09", true),
      () => reopenMonthlyRoi("other", "2026-09"), () => recordMonthlyDelivery("other", "2026-09", "sent"), () => previewMonthlyRoiImport("other", "2026-09", form)]) {
      await expect(action()).rejects.toThrow("Forbidden");
    }
    expect(db.monthlyRoiReport.findUnique).not.toHaveBeenCalled(); expect(db.tenant.findUnique).not.toHaveBeenCalled();
  });
  it("PDF admin exige admin mesmo por URL direta", async () => {
    guards.superadmin.mockRejectedValue(new Error("Forbidden"));
    await expect(adminPdf(new Request("https://test/admin/relatorios/other/pdf"), { params: Promise.resolve({ tenantId: "other" }) })).rejects.toThrow("Forbidden");
    expect(db.tenant.findUnique).not.toHaveBeenCalled();
  });
  it("PDF cliente exige papel produto e tenant ativo", async () => {
    guards.product.mockRejectedValueOnce(new Error("Affiliate only"));
    await expect(ownerPdf(new Request("https://test/relatorios/mensal/pdf"))).rejects.toThrow("Affiliate only");
    expect(db.tenant.findUnique).not.toHaveBeenCalled();
    db.tenant.findUnique.mockResolvedValueOnce({ status: "suspended" });
    expect((await ownerPdf(new Request("https://test/relatorios/mensal/pdf"))).status).toBe(403);
  });
  it("PDF ignora tenant forjado na query e não libera rascunho", async () => {
    db.monthlyRoiReport.findUnique.mockResolvedValue({ status: "draft" });
    expect((await ownerPdf(new Request("https://test/relatorios/mensal/pdf?mes=2026-09&tenantId=other"))).status).toBe(404);
    expect(db.monthlyRoiReport.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId_month: { tenantId: "own", month: "2026-09" } } }));
  });
  it("todas as fontes filtram o tenant e excluem testes", async () => {
    db.monthlyRoiReport.findUnique.mockResolvedValue(null);
    await computeMonthlyReport("own", "2026-09");
    expect(db.conversation.findMany.mock.calls[0][0].where).toMatchObject({ tenantId: "own", isTest: false, lead: { isTest: false } });
    expect(db.appointment.findMany.mock.calls[0][0].where).toMatchObject({ tenantId: "own", lead: { isTest: false } });
    expect(db.reportEvent.findMany.mock.calls[0][0].where).toMatchObject({ tenantId: "own", conversation: { isTest: false, lead: { isTest: false } } });
    expect(db.message.groupBy.mock.calls[0][0].where).toMatchObject({ conversation: { tenantId: "own", isTest: false } });
  });
  it("evento sandbox ou de outra conta não é registrado", async () => {
    db.conversation.findFirst.mockResolvedValue(null);
    await recordReportEvent({ tenantId: "own", conversationId: "test", kind: "handoff" });
    expect(db.conversation.findFirst.mock.calls[0][0].where).toMatchObject({ tenantId: "own", isTest: false, lead: { isTest: false } });
    expect(db.reportEvent.upsert).not.toHaveBeenCalled();
  });
  it("eventos repetidos usam a mesma chave e falha não interrompe atendimento", async () => {
    db.conversation.findFirst.mockResolvedValue({ id: "c", messages: [{ id: "m" }] });
    await recordReportEvent({ tenantId: "own", conversationId: "c", kind: "unanswered" });
    await recordReportEvent({ tenantId: "own", conversationId: "c", kind: "unanswered" });
    expect(db.reportEvent.upsert.mock.calls[0][0].where).toEqual(db.reportEvent.upsert.mock.calls[1][0].where);
    db.reportEvent.upsert.mockRejectedValueOnce(new Error("DB off")); vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(recordReportEvent({ tenantId: "own", conversationId: "c", kind: "handoff" })).resolves.toBeUndefined();
  });
});
describe("fechamento e entrega", () => {
  it("carrega correções salvas do mês e conserva os dados manuais do comparativo", async () => {
    const saved = { status: "draft", assumptions: { ...roiConfig(), metricOverrides: { current: { newContacts: 42, assumedHours: 3 }, previous: { newContacts: 21 } } }, adjustments: "Já ajustado", nextMonth: "Já planejado", decisionMaker: "Decisor", updatedAt: new Date("2026-10-01T12:00:00Z") };
    db.monthlyRoiReport.findUnique.mockImplementation(async ({ where }) => where.tenantId_month.month === "2026-09" ? saved : null);
    const report = await computeMonthlyReport("own", "2026-09");
    expect(report.current.newContacts).toBe(42); expect(report.current.assumedHours).toBe(3); expect(report.previous.newContacts).toBe(21);
    expect(report.automatic?.current.newContacts).not.toBe(42); expect(report.adjustments).toBe("Já ajustado");
    expect(report.revision).toBe(saved.updatedAt.toISOString());
  });
  it("salva indicadores no documento mensal sem alterar as conversas ou a agenda", async () => {
    db.monthlyRoiReport.findUnique.mockResolvedValue(null);
    const form = new FormData(); form.set("assumptions", JSON.stringify(roiConfig()));
    form.set("metricOverrides", JSON.stringify({ current: { newContacts: 30 }, previous: {} }));
    expect((await saveMonthlyRoi("own", "2026-09", null, form)).ok).toBe(true);
    expect(db.monthlyRoiReport.create.mock.calls[0][0].data.assumptions.metricOverrides.current.newContacts).toBe(30);
    expect(db.appointment.findMany).not.toHaveBeenCalled(); expect(integration).not.toHaveBeenCalled();
  });
  it("recusa dados inválidos e edição de uma revisão antiga", async () => {
    const form = new FormData(); form.set("assumptions", JSON.stringify(roiConfig()));
    form.set("metricOverrides", JSON.stringify({ current: { newContacts: -1 }, previous: {} }));
    expect((await saveMonthlyRoi("own", "2026-09", null, form)).ok).toBe(false);
    expect(db.$transaction).not.toHaveBeenCalled();
    form.set("metricOverrides", JSON.stringify({ current: { newContacts: 30 }, previous: {} })); form.set("revision", "old");
    db.monthlyRoiReport.findUnique.mockResolvedValue({ status: "draft", updatedAt: new Date() });
    expect((await saveMonthlyRoi("own", "2026-09", null, form)).ok).toBe(false); expect(db.monthlyRoiReport.updateMany).not.toHaveBeenCalled();
  });
  it("reabrir um relatório existente carrega os números do snapshot em vez de zerar os campos", async () => {
    const snapshot = { ...roiFixture(), status: "ready" }; snapshot.current.newContacts = 55;
    db.monthlyRoiReport.findUnique.mockResolvedValue({ id: "r", status: "ready", month: "2026-09", snapshot, assumptions: roiConfig(), sentAt: null, updatedAt: new Date() });
    expect((await reopenMonthlyRoi("own", "2026-09")).ok).toBe(true);
    expect(db.monthlyRoiReport.updateMany.mock.calls[0][0].data.assumptions.metricOverrides.current.newContacts).toBe(55);
    expect(db.monthlyRoiReport.updateMany.mock.calls[0][0].data).not.toHaveProperty("snapshot");
  });
  it("o comparativo de uma revisão reaberta conserva exatamente os dados do relatório existente", async () => {
    const snapshot = roiFixture(); snapshot.previous.roiPercent = 123.4;
    const saved = { status: "draft", assumptions: { ...roiConfig(), metricOverrides: { current: {}, previous: {} } }, snapshot };
    db.monthlyRoiReport.findUnique.mockImplementation(async ({ where }) => where.tenantId_month.month === "2026-09" ? saved : null);
    const report = await computeMonthlyReport("own", "2026-09");
    expect(report.previous).toEqual(snapshot.previous); expect(report.previous.roiPercent).toBe(123.4);
    expect(report.previousAssumptions).toEqual(snapshot.previousAssumptions);
  });
  it("nova competência copia apenas premissas de um mês anterior, sem alterar seu histórico", async () => {
    db.monthlyRoiReport.findUnique.mockResolvedValue(null);
    db.monthlyRoiReport.findFirst.mockResolvedValue({ month: "2026-08", assumptions: roiConfig() });
    const report = await computeMonthlyReport("own", "2026-09");
    expect(report.assumptions).toEqual(roiConfig()); expect(report.assumptionsFromMonth).toBe("2026-08");
    expect(db.monthlyRoiReport.findFirst.mock.calls[0][0].where).toEqual({ tenantId: "own", month: { lt: "2026-09" } });
    expect(db.monthlyRoiReport.updateMany).not.toHaveBeenCalled();
  });
  it("snapshot fechado conserva números e premissas sem consultar Clinicorp", async () => {
    const snapshot = { ...roiFixture(), status: "ready" };
    db.monthlyRoiReport.findUnique.mockResolvedValue({ status: "ready", snapshot, sentAt: new Date("2026-10-05T12:00:00Z") });
    const report = await computeMonthlyReport("own", "2026-09");
    expect(report.current).toEqual(snapshot.current); expect(report.sentAt).toBe("2026-10-05T12:00:00.000Z");
    expect(integration).not.toHaveBeenCalled(); expect(db.appointment.findMany).not.toHaveBeenCalled();
  });
  it("não fecha mês em andamento nem ignora mudança concorrente", async () => {
    const saved = { id: "r", month: "2026-09", status: "draft", assumptions: roiConfig(), adjustments: "Ajustes", nextMonth: "Plano", decisionMaker: "Decisor", updatedAt: new Date("2026-10-01T12:00:00Z") };
    db.monthlyRoiReport.findUnique.mockImplementation(async ({ where }) => where.tenantId_month.month === "2026-09" ? saved : null);
    vi.setSystemTime(new Date("2026-09-29T12:00:00Z"));
    expect((await finalizeMonthlyRoi("own", "2026-09", true)).ok).toBe(false); expect(db.monthlyRoiReport.updateMany).not.toHaveBeenCalled();
    vi.setSystemTime(new Date("2026-10-06T12:00:00Z")); db.monthlyRoiReport.updateMany.mockResolvedValueOnce({ count: 0 });
    const result = await finalizeMonthlyRoi("own", "2026-09", true);
    expect(result.error).toContain("mudou");
    expect(db.monthlyRoiReport.updateMany.mock.calls[0][0].where).toMatchObject({ tenantId: "own", status: "draft", updatedAt: saved.updatedAt });
  });
  it("relatório já enviado não pode ser reaberto e reunião exige envio", async () => {
    db.monthlyRoiReport.findUnique.mockResolvedValue({ id: "r", status: "ready", sentAt: new Date() });
    expect((await reopenMonthlyRoi("own", "2026-09")).ok).toBe(false);
    db.monthlyRoiReport.findUnique.mockResolvedValue({ id: "r", status: "ready", sentAt: null });
    expect((await recordMonthlyDelivery("own", "2026-09", "meeting")).ok).toBe(false);
    expect(db.monthlyRoiReport.updateMany).not.toHaveBeenCalled();
  });
});
