import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({
  message: { findMany: vi.fn() },
  lead: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
  conversation: { count: vi.fn(), findMany: vi.fn(), groupBy: vi.fn() },
  reportEvent: { findMany: vi.fn() }, appointment: { findMany: vi.fn() }, agent: { findMany: vi.fn() },
  monthlyRoiReport: { findUnique: vi.fn() }, tenantServiceArea: { findUnique: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
import { computePeriodReport, resolveRange } from "@/modules/reports/service";
import { EMPTY_ASSUMPTIONS } from "@/modules/reports/monthly-config";
import { loadLeadQualityDetail } from "@/modules/lead-insights/queries";
import { loadHistoricalCities } from "@/modules/lead-insights/historical-city-store";
const date = (day = 10) => new Date(`2026-09-${String(day).padStart(2, "0")}T13:00:00Z`);

beforeEach(() => {
  vi.resetAllMocks();
  db.lead.findMany.mockResolvedValue([]); db.lead.groupBy.mockResolvedValue([]); db.lead.count.mockResolvedValue(0);
  db.conversation.findMany.mockResolvedValue([]); db.conversation.groupBy.mockResolvedValue([]); db.conversation.count.mockResolvedValue(0);
  db.appointment.findMany.mockResolvedValue([]); db.agent.findMany.mockResolvedValue([]);
  db.reportEvent.findMany.mockResolvedValue([]);
  db.message.findMany.mockResolvedValue([]); db.monthlyRoiReport.findUnique.mockResolvedValue(null);
  db.tenantServiceArea.findUnique.mockResolvedValue(null);
});

describe("consultas do operacional", () => {
  it("compara competências completas por mês civil, inclusive fevereiro e virada de ano", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
      const september = resolveRange("30", "2026-09-01", "2026-09-30");
      expect(september.prevFrom?.toISOString()).toBe("2026-08-01T03:00:00.000Z");
      expect(september.prevTo?.toISOString()).toBe("2026-09-01T02:59:59.999Z");
      expect(resolveRange("30", "2026-02-01", "2026-02-28").prevFrom?.toISOString()).toBe("2026-01-01T03:00:00.000Z");
      expect(resolveRange("30", "2026-01-01", "2026-01-31").prevFrom?.toISOString()).toBe("2025-12-01T03:00:00.000Z");
      expect(resolveRange("30", "2026-09-10", "2026-09-20").prevFrom?.toISOString()).toBe("2026-08-30T03:00:00.000Z");
    } finally { vi.useRealTimers(); }
  });

  it("conta pelos registros do mês, não updatedAt, e alinha todos os gráficos ao total", async () => {
    db.message.findMany.mockResolvedValue([
      { conversationId: "old", role: "user", sentBy: null, createdAt: date(1) },
      { conversationId: "old", role: "assistant", sentBy: "agent", createdAt: new Date(+date(1) + 20_000) },
      { conversationId: "old", role: "assistant", sentBy: "human", createdAt: date(20) },
      { conversationId: "other", role: "user", sentBy: null, createdAt: date(2) },
      { conversationId: "other", role: "assistant", sentBy: "agent", createdAt: new Date(+date(2) + 30_000) },
      { conversationId: "unanswered", role: "user", sentBy: null, createdAt: date(3) },
      { conversationId: "unanswered", role: "user", sentBy: null, createdAt: date(4) },
    ]);
    db.appointment.findMany.mockImplementation(async ({ select }) => select.attendance ? [] : [
      { createdAt: date(30), source: "agent", kind: "evaluation", serviceType: null, agentId: "a" },
      { createdAt: date(30), source: "manual", kind: "evaluation", serviceType: null, agentId: "a" },
      { createdAt: date(30), source: "agent", kind: "treatment", serviceType: null, agentId: "a" },
    ]);
    const range = { ...resolveRange("mes", "2026-09-01", "2026-09-30"), prevFrom: null, prevTo: null };
    const r = await computePeriodReport("tenant", range, { assumptions: EMPTY_ASSUMPTIONS });
    expect(r.kpis).toMatchObject({ conversations: 3, attendedContacts: 2, responseRate: 2 / 3, inbound: 4, outbound: 3, scheduled: 3, evaluations: 1 });
    expect(r.attendance.reduce((n, b) => n + b.ai + b.human, 0)).toBe(2);
    expect(r.autonomyRate.current).toBe(0.5);
    expect(r.closed.reduce((n, b) => n + b.ai + b.human, 0)).toBe(3);
    expect(r.results.reduce((n, b) => n + b.appts, 0)).toBe(3);
    for (const call of db.appointment.findMany.mock.calls) {
      expect(call[0].where).toMatchObject({ tenantId: "tenant", lead: { isTest: false }, conversation: { isTest: false } });
    }
    expect(db.appointment.findMany.mock.calls[0][0].where).toHaveProperty("createdAt");
    expect(JSON.stringify(db.conversation.groupBy.mock.calls)).not.toContain("updatedAt");
    expect(db.message.findMany.mock.calls[0][0].where.conversation).toMatchObject({ tenantId: "tenant", isTest: false, lead: { isTest: false } });
  });
  it("usa as regras da revisão mensal para avaliações de uma competência inteira", async () => {
    db.monthlyRoiReport.findUnique.mockResolvedValue({ assumptions: { ...EMPTY_ASSUMPTIONS, evaluationTypes: ["Check-up"], agentIds: ["chosen"] } });
    db.appointment.findMany.mockImplementation(async ({ select }) => select.attendance ? [] : [
      { createdAt: date(), source: "agent", kind: null, serviceType: "Check-up", agentId: "chosen" },
      { createdAt: date(), source: "agent", kind: null, serviceType: "Check-up", agentId: "other" },
    ]);
    const r = await computePeriodReport("tenant", { ...resolveRange("mes", "2026-09-01", "2026-09-30"), prevFrom: null, prevTo: null });
    expect(r.kpis.evaluations).toBe(1);
    expect(db.monthlyRoiReport.findUnique.mock.calls[0][0].where).toEqual({ tenantId_month: { tenantId: "tenant", month: "2026-09" } });
  });
});

describe("histórico de cidades na população do mês", () => {
  it("inclui o contato antigo atendido e devolve apenas a origem, sem mensagem nem dados pessoais", async () => {
    const conversation = { id: "old", needsHuman: false, lastInboundAt: date(), followUpReason: null, reportEvents: [], insight: null,
      messages: [{ role: "user", sentBy: null, createdAt: date() }, { role: "assistant", sentBy: "agent", createdAt: new Date(+date() + 20_000) }] };
    db.lead.findMany.mockResolvedValue([{ id: "lead", createdAt: new Date("2025-01-01T00:00:00Z"), status: "new", disqualifiedAt: null, disqualifiedReason: null, appointments: [], conversation }]);
    db.message.findMany.mockResolvedValue([{ id: "literal", conversationId: "old", role: "user", content: "Sou de Marília", createdAt: new Date("2026-08-01T12:00:00Z") }]);
    const r = await loadLeadQualityDetail("tenant", { from: date(1), to: new Date("2026-10-01T03:00:00Z") });
    expect(r.quality).toMatchObject({ leads: 1, withCity: 1, areaConfigured: false });
    expect(r.leads[0]).toMatchObject({ city: "Marília", verdict: "unknown", cityMessageId: "literal", cityDeclaredAt: "2026-08-01T12:00:00.000Z" });
    expect(JSON.stringify(r)).not.toContain("Sou de");
    expect(db.lead.findMany.mock.calls[0][0].where).not.toHaveProperty("createdAt");
    expect(db.message.findMany.mock.calls[0][0].where).toMatchObject({ conversation: { tenantId: "tenant", isTest: false, lead: { isTest: false } }, createdAt: { lt: new Date("2026-10-01T03:00:00Z") } });
  });
  it("mantém a pergunta anterior entre páginas e não trunca o histórico", async () => {
    const noise = Array.from({ length: 999 }, (_, n) => ({ id: String(n), conversationId: "old", role: "user", content: "Olá", createdAt: date(1) }));
    db.message.findMany.mockResolvedValueOnce([...noise, { id: "question", conversationId: "old", role: "assistant", content: "Qual sua cidade?", createdAt: date(2) }])
      .mockResolvedValueOnce([{ id: "answer", conversationId: "old", role: "user", content: "Garça", createdAt: date(3) }]);
    const result = await loadHistoricalCities("tenant", ["old"], date(30));
    expect(result.get("old")).toMatchObject({ cityKey: "garca", messageId: "answer" });
    expect(db.message.findMany.mock.calls[1][0]).toMatchObject({ cursor: { id: "question" }, skip: 1 });
  });
  it("preserva o registro explícito do agente e ignora contatos sem resposta", async () => {
    const conversation = { id: "old", needsHuman: false, lastInboundAt: date(), followUpReason: null, reportEvents: [],
      insight: { city: "Garça", cityKey: "garca", firstQuestionKey: null, lossReasonKey: null },
      messages: [{ role: "user", sentBy: null, createdAt: date() }, { role: "assistant", sentBy: "human", createdAt: new Date(+date() + 1000) }] };
    const lead = { id: "lead", createdAt: date(), status: "new", disqualifiedAt: null, disqualifiedReason: null, appointments: [], conversation };
    db.lead.findMany.mockResolvedValue([lead, { ...lead, id: "no-response", conversation: { ...conversation, id: "unanswered", messages: [conversation.messages[0]] } }]);
    expect((await loadLeadQualityDetail("tenant", { from: date(1), to: date(30) })).quality).toMatchObject({ leads: 1, withCity: 1 });
    expect(db.message.findMany).not.toHaveBeenCalled();
  });
});
