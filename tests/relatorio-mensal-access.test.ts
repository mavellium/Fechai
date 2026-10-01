import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({
  tenant: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
  agent: { findMany: vi.fn() },
  monthlyRoiReport: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  conversation: { findMany: vi.fn(), findFirst: vi.fn() },
  appointment: { findMany: vi.fn() },
  reportEvent: { findMany: vi.fn(), upsert: vi.fn() },
  message: { groupBy: vi.fn(), findMany: vi.fn() }, $transaction: vi.fn(),
  knowledgeGap: { findMany: vi.fn() },
  lead: { findMany: vi.fn() },
  whatsappIncident: { findMany: vi.fn() },
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
import { limitationFingerprint } from "@/modules/reports/monthly-limitations";

beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
  guards.superadmin.mockResolvedValue({ user: { id: "admin" } });
  guards.product.mockResolvedValue({}); guards.tenant.mockResolvedValue({ tenantId: "own" });
  // `whatsappIncident.findMany` fica sem retorno: conta sem leitura de quedas, disponibilidade "sem registro".
  db.knowledgeGap.findMany.mockResolvedValue([]);
  db.message.findMany.mockResolvedValue([]); db.lead.findMany.mockResolvedValue([]);
  db.tenant.findUnique.mockResolvedValue({ id: "own", status: "active", ownerNames: ["Decisor"] });
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
    for (const action of [() => saveMonthlyRoi("other", "2026-09", null, form), () => finalizeMonthlyRoi("other", "2026-09", []),
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
    // Áudios não ouvidos: só das conversas já filtradas acima.
    expect(db.message.findMany.mock.calls[0][0].where).toMatchObject({ role: "user", content: "[Áudio]", conversationId: { in: ["outside"] } });
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
    const saved = { id: "r", month: "2026-09", status: "draft", assumptions: roiConfig(), adjustments: "Ajustes", nextMonth: "Plano", decisionMaker: "Decisor", limitationsNote: "Uma avaliação ficou para outubro.", updatedAt: new Date("2026-10-01T12:00:00Z") };
    db.monthlyRoiReport.findUnique.mockImplementation(async ({ where }) => where.tenantId_month.month === "2026-09" ? saved : null);
    vi.setSystemTime(new Date("2026-09-29T12:00:00Z"));
    expect((await finalizeMonthlyRoi("own", "2026-09", [])).ok).toBe(false); expect(db.monthlyRoiReport.updateMany).not.toHaveBeenCalled();
    vi.setSystemTime(new Date("2026-10-06T12:00:00Z")); db.monthlyRoiReport.updateMany.mockResolvedValueOnce({ count: 0 });
    const seen = limitationFingerprint((await computeMonthlyReport("own", "2026-09", false)).limitations ?? []);
    const result = await finalizeMonthlyRoi("own", "2026-09", seen);
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

describe("caso do mês", () => {
  const form = (featuredCase: string) => {
    const data = new FormData(); data.set("assumptions", JSON.stringify(roiConfig())); data.set("featuredCase", featuredCase);
    return data;
  };
  beforeEach(() => { db.monthlyRoiReport.findUnique.mockResolvedValue(null); db.lead.findMany.mockResolvedValue([{ name: "Maria Aparecida" }]); });
  it("recusa o nome de um contato do mês e não grava", async () => {
    const result = await saveMonthlyRoi("own", "2026-09", null, form("A Maria, de 74 anos, mandou dois áudios longos."));
    expect(result.ok).toBe(false); expect(result.error).toContain("maria");
    expect(db.monthlyRoiReport.create).not.toHaveBeenCalled();
    // Só contatos reais desta conta com mensagem no mês.
    expect(db.lead.findMany.mock.calls[0][0].where).toMatchObject({ tenantId: "own", isTest: false,
      conversation: { messages: { some: { createdAt: { gte: new Date("2026-09-01T03:00:00Z"), lt: new Date("2026-10-01T03:00:00Z") } } } } });
  });
  it("grava o perfil genérico junto da revisão", async () => {
    const text = "Uma paciente de 74 anos enviou 2 áudios de quase 5 minutos; o agente ouviu tudo e deixou o retorno combinado.";
    expect((await saveMonthlyRoi("own", "2026-09", null, form(text))).ok).toBe(true);
    expect(db.monthlyRoiReport.create.mock.calls[0][0].data.featuredCase).toBe(text);
  });
  it("sem caso não consulta contatos", async () => {
    expect((await saveMonthlyRoi("own", "2026-09", null, form(""))).ok).toBe(true);
    expect(db.lead.findMany).not.toHaveBeenCalled();
  });
});

describe("fechamento com cobertura parcial", () => {
  const saved = () => ({ id: "r", month: "2026-09", status: "draft", assumptions: { ...roiConfig(), financialEnabled: true, attendantMonthlyCents: null },
    adjustments: "Ajustes", nextMonth: "Plano", decisionMaker: "Decisor", highlights: "", limitationsNote: "Falta o custo da recepção.", updatedAt: new Date("2026-10-01T12:00:00Z") });
  beforeEach(() => {
    const row = saved();
    db.monthlyRoiReport.findUnique.mockImplementation(async ({ where }) => where.tenantId_month.month === "2026-09" ? row : null);
  });
  it("fecha com pendência depois de confirmar a lista, e congela o número sem evidência como não verificado", async () => {
    const seen = limitationFingerprint((await computeMonthlyReport("own", "2026-09", false)).limitations ?? []);
    expect(seen.some((l) => l.startsWith("team|"))).toBe(true);
    const result = await finalizeMonthlyRoi("own", "2026-09", seen);
    expect(result.ok).toBe(true); expect(result.info).toContain("cobertura parcial");
    const snapshot = db.monthlyRoiReport.updateMany.mock.calls[0][0].data.snapshot;
    expect(snapshot.status).toBe("ready");
    expect(snapshot.current.savingsCents).toBeNull(); expect(snapshot.current.roiPercent).toBeNull();
    expect(snapshot.quality.savings.status).toBe("pending"); expect(snapshot.limitations.map((l: { key: string }) => l.key)).toContain("team");
    expect(snapshot.limitationsNote).toBe("Falta o custo da recepção.");
    // Receita tem evidência: não é derrubada pela falta do custo da equipe.
    expect(snapshot.current.revenueCents).not.toBeNull();
  });
  it("recusa sem confirmação e quando a lista mudou desde a conferência", async () => {
    expect((await finalizeMonthlyRoi("own", "2026-09", [])).error).toContain("Confirme as limitações");
    expect((await finalizeMonthlyRoi("own", "2026-09", ["team|2 presenças pendentes."])).error).toContain("mudaram");
    expect(db.monthlyRoiReport.updateMany).not.toHaveBeenCalled();
  });
  it("destaques e limitações não podem citar contato do mês", async () => {
    db.monthlyRoiReport.findUnique.mockResolvedValue(null); db.lead.findMany.mockResolvedValue([{ name: "Maria Aparecida" }]);
    const data = new FormData(); data.set("assumptions", JSON.stringify(roiConfig()));
    data.set("highlights", "A Maria agendou implante fora do horário.");
    const result = await saveMonthlyRoi("own", "2026-09", null, data);
    expect(result.ok).toBe(false); expect(result.error).toContain("Resumo do período");
    data.set("highlights", "R$ 12.345,67 estimados em 1.234.567 mensagens."); data.set("limitationsNote", "Faltou o custo.");
    expect((await saveMonthlyRoi("own", "2026-09", null, data)).ok).toBe(true);
    expect(db.monthlyRoiReport.create.mock.calls[0][0].data).toMatchObject({ highlights: "R$ 12.345,67 estimados em 1.234.567 mensagens.", limitationsNote: "Faltou o custo." });
  });
});

describe("decisor é dono ou sócio, não o contato operacional", () => {
  // Como o Instituto do Sorriso: a recepção estava no campo do decisor.
  const saved = (decisionMaker: string, operationalContact = "") => ({ id: "r", month: "2026-09", status: "draft", assumptions: { ...roiConfig(), procedures: [], investmentCents: null },
    adjustments: "Ajustes", nextMonth: "", nextActions: [{ action: "Confirmar comparecimentos", owner: "Recepção", indicator: "Comparecimentos confirmados" }],
    decisionMaker, operationalContact, highlights: "", limitationsNote: "Duas avaliações ficaram para outubro.", updatedAt: new Date("2026-10-01T12:00:00Z") });
  const use = (row: ReturnType<typeof saved>) => db.monthlyRoiReport.findUnique.mockImplementation(async ({ where }) => where.tenantId_month.month === "2026-09" ? row : null);
  const owners = (ownerNames: string[]) => db.tenant.findUnique.mockResolvedValue({ id: "own", status: "active", ownerNames });
  const form = (fields: Record<string, string>) => {
    const data = new FormData(); data.set("assumptions", JSON.stringify(roiConfig()));
    for (const [key, value] of Object.entries(fields)) data.set(key, value);
    return data;
  };
  it("recusa fechar com quem não é dono ou sócio da conta", async () => {
    owners(["Dra. Ana Souza"]); use(saved("Thalita Santos"));
    const result = await finalizeMonthlyRoi("own", "2026-09", []);
    expect(result.ok).toBe(false); expect(result.error).toContain("donos e sócios");
    expect(db.monthlyRoiReport.updateMany).not.toHaveBeenCalled();
  });
  it("recusa fechar com o contato operacional no campo do decisor, mesmo listado como dono", async () => {
    owners(["Thalita Santos"]); use(saved("Thalita Santos", "thalita  santos"));
    const result = await finalizeMonthlyRoi("own", "2026-09", []);
    expect(result.ok).toBe(false); expect(result.error).toContain("contato operacional");
    expect(db.monthlyRoiReport.updateMany).not.toHaveBeenCalled();
  });
  it("recusa fechar sem decisor e sem donos na conta", async () => {
    owners([]); use(saved(""));
    expect((await finalizeMonthlyRoi("own", "2026-09", [])).error).toContain("Escolha o decisor");
    use(saved("Thalita Santos"));
    expect((await finalizeMonthlyRoi("own", "2026-09", [])).ok).toBe(false);
    expect(db.monthlyRoiReport.updateMany).not.toHaveBeenCalled();
  });
  it("fecha com o dono como decisor e congela o contato operacional no snapshot", async () => {
    owners(["Dra. Ana Souza"]); use(saved("dra. ana souza", "Thalita Santos"));
    expect(await finalizeMonthlyRoi("own", "2026-09", [])).toMatchObject({ ok: true });
    const snapshot = db.monthlyRoiReport.updateMany.mock.calls[0][0].data.snapshot;
    expect(snapshot.decisionMaker).toBe("dra. ana souza"); expect(snapshot.operationalContact).toBe("Thalita Santos");
  });
  it("salvar grava os donos na conta, o decisor e o contato; decisor de fora da lista é recusado", async () => {
    db.monthlyRoiReport.findUnique.mockResolvedValue(null); owners([]);
    const refused = await saveMonthlyRoi("own", "2026-09", null, form({ decisionMaker: "Thalita Santos", accountOwners: JSON.stringify(["Dra. Ana Souza"]) }));
    expect(refused.ok).toBe(false); expect(db.monthlyRoiReport.create).not.toHaveBeenCalled(); expect(db.tenant.update).not.toHaveBeenCalled();
    const same = await saveMonthlyRoi("own", "2026-09", null, form({ decisionMaker: "Dra. Ana Souza", operationalContact: "Dra. Ana Souza", accountOwners: JSON.stringify(["Dra. Ana Souza"]) }));
    expect(same.ok).toBe(false); expect(same.error).toContain("contato operacional");
    const ok = await saveMonthlyRoi("own", "2026-09", null, form({ decisionMaker: "Dra. Ana Souza", operationalContact: "Thalita Santos", accountOwners: JSON.stringify([" Dra. Ana Souza ", "dra. ana souza", ""]) }));
    expect(ok.ok).toBe(true);
    expect(db.monthlyRoiReport.create.mock.calls[0][0].data).toMatchObject({ decisionMaker: "Dra. Ana Souza", operationalContact: "Thalita Santos" });
    expect(db.tenant.update).toHaveBeenCalledWith({ where: { id: "own" }, data: { ownerNames: ["Dra. Ana Souza"] } });
  });
  it("rascunho sem decisor é salvo, e sem o campo de donos a lista da conta não muda", async () => {
    db.monthlyRoiReport.findUnique.mockResolvedValue(null);
    expect((await saveMonthlyRoi("own", "2026-09", null, form({ operationalContact: "Thalita Santos" }))).ok).toBe(true);
    expect(db.tenant.update).not.toHaveBeenCalled();
  });
  it("envio é registrado com o decisor do fechamento e recusado quando ele é a recepção", async () => {
    const ready = (decisionMaker: string) => ({ id: "r", status: "ready", sentAt: null, decisionMaker, operationalContact: "", snapshot: { ...roiFixture(), decisionMaker } });
    owners(["Dra. Ana Souza"]); db.monthlyRoiReport.findUnique.mockResolvedValue(ready("Thalita Santos"));
    const refused = await recordMonthlyDelivery("own", "2026-09", "sent");
    expect(refused.ok).toBe(false); expect(refused.error).toContain("Reabra a revisão"); expect(db.monthlyRoiReport.updateMany).not.toHaveBeenCalled();
    db.monthlyRoiReport.findUnique.mockResolvedValue(ready("Dra. Ana Souza"));
    expect(await recordMonthlyDelivery("own", "2026-09", "sent")).toEqual({ ok: true, info: "Envio a Dra. Ana Souza registrado." });
    db.monthlyRoiReport.findUnique.mockResolvedValue({ ...ready("Dra. Ana Souza"), sentAt: new Date() });
    expect((await recordMonthlyDelivery("own", "2026-09", "meeting")).info).toBe("Reunião com Dra. Ana Souza registrada.");
  });
});

describe("aceite: fechar sem premissas financeiras", () => {
  // Como o Instituto do Sorriso: sem ticket, conversão nem mensalidade conferida.
  const saved = (limitationsNote: string) => ({ id: "r", month: "2026-09", status: "draft", assumptions: { ...roiConfig(), procedures: [], investmentCents: null },
    adjustments: "Ajustes", nextMonth: "", nextActions: [{ action: "Confirmar comparecimentos", owner: "Recepção", indicator: "Comparecimentos confirmados" }],
    decisionMaker: "Decisor", highlights: "", limitationsNote, updatedAt: new Date("2026-10-01T12:00:00Z") });
  const use = (row: ReturnType<typeof saved>) => db.monthlyRoiReport.findUnique.mockImplementation(async ({ where }) => where.tenantId_month.month === "2026-09" ? row : null);
  it("o fechamento é aceito, sem limitação financeira para confirmar e sem dinheiro no snapshot", async () => {
    use(saved("Duas avaliações ficaram para outubro por falta de horário."));
    const result = await finalizeMonthlyRoi("own", "2026-09", []);
    expect(result).toMatchObject({ ok: true }); expect(result.info).not.toContain("cobertura parcial");
    const snapshot = db.monthlyRoiReport.updateMany.mock.calls[0][0].data.snapshot;
    expect(snapshot.limitations).toEqual([]); expect(snapshot.current.missing).toEqual([]);
    expect([snapshot.current.revenueCents, snapshot.current.savingsCents, snapshot.current.roiPercent]).toEqual([null, null, null]);
    expect(snapshot.quality.roi).toBeUndefined();
    // A âncora está lá.
    expect(snapshot.current.scheduled).toEqual({ inside: 0, outside: 1, unclassified: 0 });
  });
  it("\"o que não saiu como planejado\" em branco não trava: sem incidente comprovado, a seção diz isso", async () => {
    use(saved(""));
    expect(await finalizeMonthlyRoi("own", "2026-09", [])).toMatchObject({ ok: true });
    const snapshot = db.monthlyRoiReport.updateMany.mock.calls[0][0].data.snapshot;
    expect(snapshot.limitationsNote).toBe(""); expect(snapshot.limitations).toEqual([]);
  });
});

describe("modelo revisado: versão aprovada, ações do mês anterior e caso do mês", () => {
  const draft = (extra: Record<string, unknown> = {}) => ({ id: "r", month: "2026-09", status: "draft", assumptions: { ...roiConfig(), procedures: [], investmentCents: null },
    adjustments: "Ajustes", nextMonth: "", nextActions: [{ action: "Confirmar comparecimentos", owner: "Recepção", indicator: "Comparecimentos confirmados" }],
    decisionMaker: "Decisor", highlights: "", limitationsNote: "", updatedAt: new Date("2026-10-01T12:00:00Z"), ...extra });
  /** Agosto fechado, com uma ação combinada para setembro. */
  const august = () => { const snapshot = { ...roiFixture(), month: "2026-08", status: "ready", nextActions: [{ action: "Lembrete na véspera da consulta", owner: "Mavellium", indicator: "Faltas" }] };
    return { status: "ready", assumptions: roiConfig(), snapshot }; };
  const use = (september: unknown, previous: unknown = null) => db.monthlyRoiReport.findUnique.mockImplementation(async ({ where }) =>
    where.tenantId_month.month === "2026-09" ? september : where.tenantId_month.month === "2026-08" ? previous : null);
  const form = (fields: Record<string, string>) => {
    const data = new FormData(); data.set("assumptions", JSON.stringify(roiConfig()));
    for (const [key, value] of Object.entries(fields)) data.set(key, value);
    return data;
  };
  it("cada fechamento é uma versão: o snapshot leva o número e a data da aprovação", async () => {
    use(draft({ approvalVersion: 1 }));
    expect(await finalizeMonthlyRoi("own", "2026-09", [])).toMatchObject({ ok: true });
    const data = db.monthlyRoiReport.updateMany.mock.calls[0][0].data;
    expect(data.approvalVersion).toBe(2);
    expect(data.snapshot.approval).toEqual({ version: 2, approvedAt: "2026-10-06T12:00:00.000Z" });
  });
  it("PDF da clínica sai só do snapshot aprovado: rascunho, reaberto e snapshot inválido não têm PDF", async () => {
    const url = new Request("https://test/relatorios/mensal/pdf?mes=2026-09");
    db.monthlyRoiReport.findUnique.mockResolvedValue({ status: "ready", snapshot: null });
    expect((await ownerPdf(url)).status).toBe(404);
    db.monthlyRoiReport.findUnique.mockResolvedValue({ status: "ready", snapshot: { ...roiFixture(), month: "2026-08" } });
    expect((await ownerPdf(url)).status).toBe(404);
    db.monthlyRoiReport.findUnique.mockResolvedValue({ status: "ready", snapshot: { ...roiFixture(), status: "ready" } });
    const response = await ownerPdf(url);
    expect(response.status).toBe(200); expect(response.headers.get("Content-Type")).toBe("application/pdf");
    // Nada é recalculado para entregar: nenhuma consulta de conversa, agenda ou Clinicorp.
    expect(db.conversation.findMany).not.toHaveBeenCalled(); expect(integration).not.toHaveBeenCalled();
  });
  it("as ações combinadas no relatório anterior aprovado voltam para avaliar, e fechar exige status e resultado", async () => {
    use(draft(), august());
    const report = await computeMonthlyReport("own", "2026-09", false);
    expect(report.previousActions).toEqual([{ action: "Lembrete na véspera da consulta", owner: "Mavellium", indicator: "Faltas", status: null, result: "" }]);
    const refused = await finalizeMonthlyRoi("own", "2026-09", []);
    expect(refused.ok).toBe(false); expect(refused.error).toContain("ação combinada"); expect(db.monthlyRoiReport.updateMany).not.toHaveBeenCalled();
    use(draft({ previousActions: [{ action: "Lembrete na véspera da consulta", owner: "", indicator: "", status: "worked", result: "Faltas caíram de 31% para 22%." }] }), august());
    expect(await finalizeMonthlyRoi("own", "2026-09", [])).toMatchObject({ ok: true });
    expect(db.monthlyRoiReport.updateMany.mock.calls[0][0].data.snapshot.previousActions[0]).toMatchObject({ status: "worked", owner: "Mavellium", result: "Faltas caíram de 31% para 22%." });
  });
  it("plano em rascunho do mês anterior não foi combinado com ninguém: nada a avaliar", async () => {
    use(draft(), { status: "draft", assumptions: roiConfig(), nextActions: [{ action: "Plano não aprovado", owner: "Mavellium", indicator: "x" }] });
    expect((await computeMonthlyReport("own", "2026-09", false)).previousActions).toEqual([]);
  });
  it("salvar guarda só a avaliação: a lista de ações é a do snapshot anterior, não a do formulário", async () => {
    use(null, august());
    const result = await saveMonthlyRoi("own", "2026-09", null, form({ previousActions: JSON.stringify([
      { action: "Lembrete na véspera da consulta", status: "partial", result: "Faltas em 25%." }, { action: "Ação que ninguém combinou", status: "worked", result: "100%" }]) }));
    expect(result.ok).toBe(true);
    expect(db.monthlyRoiReport.create.mock.calls[0][0].data.previousActions).toEqual([{ action: "Lembrete na véspera da consulta", owner: "Mavellium", indicator: "Faltas", status: "partial", result: "Faltas em 25%." }]);
  });
  it("caso do mês: duração, dia e período vêm da conversa no servidor; conversa de fora é recusada e data exata no texto também", async () => {
    use(null);
    db.message.findMany.mockResolvedValue([]);
    const foreign = await saveMonthlyRoi("own", "2026-09", null, form({ caseConversationId: "de-outra-conta", caseAge: "76" }));
    expect(foreign.ok).toBe(false); expect(foreign.error).toContain("não tem áudio longo");
    expect(db.message.findMany.mock.calls[0][0].where).toMatchObject({ conversationId: "de-outra-conta", conversation: { tenantId: "own", isTest: false } });
    // Sábado 12/09 às 23:10 de Brasília.
    db.message.findMany.mockResolvedValue([{ conversationId: "c1", audioSeconds: 302, createdAt: new Date("2026-09-13T02:10:00Z") }, { conversationId: "c1", audioSeconds: 280, createdAt: new Date("2026-09-13T02:20:00Z") }]);
    expect((await saveMonthlyRoi("own", "2026-09", null, form({ caseConversationId: "c1", caseAge: "76", featuredCase: "Uma paciente de 76 anos mandou dois áudios num sábado à noite." }))).ok).toBe(true);
    expect(db.monthlyRoiReport.create.mock.calls[0][0].data.caseFacts).toEqual({ conversationId: "c1", age: 76, audioSeconds: [302, 280], weekday: 6, period: "night", scheduled: false });
    const dated = await saveMonthlyRoi("own", "2026-09", null, form({ featuredCase: "Uma paciente de 76 anos mandou dois áudios em 12/09 à noite." }));
    expect(dated.ok).toBe(false); expect(dated.error).toContain("data");
    expect((await saveMonthlyRoi("own", "2026-09", null, form({ caseConversationId: "c1", caseAge: "200" }))).ok).toBe(false);
  });
});
