import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/modules/scheduling/clinicorp", () => ({ readClinicorpReport: vi.fn() }));
import { PDFDocument } from "pdf-lib";
import { calculateMonthlyMetrics } from "@/modules/reports/monthly";
import { EMPTY_ASSUMPTIONS, monthKey, monthlyAssumptionsSchema, monthlyWindow, outsideHumanHours, parseMonthlyAssumptions } from "@/modules/reports/monthly-config";
import { generateMonthlyPdf } from "@/modules/reports/monthly-pdf";
import { roiAppointment, roiConfig, roiConversation, roiFixture, roiInput } from "./fixtures/monthly-roi";

describe("ROI mensal - regra de receita e economia", () => {
  it("usa a chegada fora do horário, mesmo quando a consulta é dentro", () => {
    const r = calculateMonthlyMetrics(roiInput());
    expect(r.attended).toEqual({ inside: 0, outside: 1, unclassified: 0 });
    expect(r.revenueCents).toBe(50_000);
    expect(r.assumedHours).toBe(0.1);
    expect(r.savingsCents).toBe(100);
    expect(r.roiPercent).toBe(401);
  });
  it("chegada dentro não gera receita, mesmo quando a consulta é à noite", () => {
    const input = roiInput();
    input.conversations = [roiConversation("inside", "2026-09-14T15:00:00Z")];
    input.appointments = [{ ...roiAppointment("a", "inside"), startsAt: new Date("2026-09-15T23:00:00Z") }];
    const r = calculateMonthlyMetrics(input);
    expect(r.attended.inside).toBe(1); expect(r.revenueCents).toBe(0);
  });
  it("soma tickets e conversões por procedimento, em centavos", () => {
    const input = roiInput();
    input.config.procedures.push({ name: "Ortodontia", ticketCents: 200_000, conversionBps: 2500 });
    input.conversations.push({ ...roiConversation("other"), variables: { procedimento: "Ortodontia" } });
    input.appointments.push(roiAppointment("other-appt", "other"));
    expect(calculateMonthlyMetrics(input).revenueCents).toBe(100_000);
  });
  it("agendadas contam na criação, realizadas na data da consulta", () => {
    const input = roiInput(); input.appointments[0].createdAt = new Date("2026-08-31T20:00:00Z");
    input.conversations[0].firstInbound = new Date("2026-08-31T10:00:00Z");
    const r = calculateMonthlyMetrics(input);
    expect(r.scheduled.outside).toBe(0); expect(r.attended.outside).toBe(1);
  });
  it("exclui canceladas, manuais e tipos que não são avaliações", () => {
    const input = roiInput(); input.appointments = [
      { ...roiAppointment("canceled"), status: "canceled" }, { ...roiAppointment("manual"), source: "manual" },
      { ...roiAppointment("treatment"), serviceType: "Tratamento" },
    ];
    const r = calculateMonthlyMetrics(input); expect(r.revenueCents).toBe(0); expect(r.attended.outside).toBe(0);
  });
  it("não transforma horário de origem ausente em fora", () => {
    const input = roiInput(); input.conversations[0].firstInbound = null;
    const r = calculateMonthlyMetrics(input); expect(r.attended.unclassified).toBe(1); expect(r.revenueCents).toBeNull();
  });
  it("não inventa receita quando falta procedimento, ticket, conversão ou horário", () => {
    for (const field of ["procedure", "ticket", "conversion", "hours"]) {
      const input = roiInput();
      if (field === "procedure") input.conversations[0].variables = {};
      if (field === "ticket") input.config.procedures[0].ticketCents = null;
      if (field === "conversion") input.config.procedures[0].conversionBps = null;
      if (field === "hours") input.config.humanHours = null;
      expect(calculateMonthlyMetrics(input).roiPercent).toBeNull();
    }
  });
  it("agendamento sem tipo exige conferência explícita", () => {
    const input = roiInput(); input.appointments[0].serviceType = null;
    expect(calculateMonthlyMetrics(input).revenueCents).toBeNull();
    input.config.countUntypedAsEvaluations = true;
    expect(calculateMonthlyMetrics(input).revenueCents).toBe(50_000);
  });
  it("conversa também respondida por humano não gera economia", () => {
    const input = roiInput(); input.conversations[0].messages.push({ id: "human", role: "assistant", sentBy: "human", createdAt: new Date("2026-09-14T10:01:00Z") });
    const r = calculateMonthlyMetrics(input); expect(r.assumedHours).toBe(0); expect(r.savingsCents).toBe(0);
  });
  it("mensalidade zero não divide por zero, conversão zero é válida", () => {
    const input = roiInput(); input.config.investmentCents = 0; input.config.procedures[0].conversionBps = 0;
    const r = calculateMonthlyMetrics(input); expect(r.roiPercent).toBeNull(); expect(r.revenueCents).toBe(0);
  });
  it("deduplica qualificados por contato e procedimento", () => {
    const input = roiInput(); input.events.push(input.events[0]);
    const r = calculateMonthlyMetrics(input); expect(r.qualified).toBe(1); expect(r.procedures[0].qualified).toBe(1);
  });
  it("usa uma primeira resposta por conversa e não respostas proativas", () => {
    const input = roiInput(); input.conversations[0].messages.unshift({ id: "proactive", role: "assistant", sentBy: "agent", createdAt: new Date("2026-09-14T09:00:00Z") });
    const r = calculateMonthlyMetrics(input); expect(r.firstResponseSeconds).toBe(10); expect(r.newContacts).toBe(1);
  });
  it("conta a resposta na virada do mês para a mensagem recebida no anterior", () => {
    const input = roiInput();
    input.conversations = [roiConversation("boundary", "2026-09-01T02:59:50Z")];
    input.conversations[0].messages[1].createdAt = new Date("2026-09-01T03:00:10Z");
    const r = calculateMonthlyMetrics(input);
    expect(r.firstResponseSeconds).toBe(20); expect(r.conversations.outside).toBe(1);
  });
  it("anuncia cobertura parcial de eventos em meses anteriores à implantação", () => {
    const input = roiInput(); input.trackingSince = new Date("2026-09-28T12:00:00Z");
    expect(calculateMonthlyMetrics(input).trackingComplete).toBe(false);
  });
});
describe("comparecimento Clinicorp", () => {
  it("status explicitamente mapeado comprova presença", () => {
    const input = roiInput(); input.appointments[0].clinicorpAppointmentId = "remote";
    input.clinicorp = { available: true, error: "", appointments: [{ id: "remote", statusType: "REALIZADO_TESTE", canceled: false }], statusTypes: [] } as typeof input.clinicorp;
    expect(calculateMonthlyMetrics(input).revenueCents).toBe(50_000);
  });
  it("confirmado não comprova presença", () => {
    const input = roiInput(); input.appointments[0].clinicorpAppointmentId = "remote";
    input.clinicorp = { available: true, error: "", appointments: [{ id: "remote", statusType: "CONFIRMED", canceled: false }], statusTypes: [] } as typeof input.clinicorp;
    expect(calculateMonthlyMetrics(input).attended.outside).toBe(0);
  });
  it("falha ou ID sem vínculo deixa pendente, mesmo com done local antigo", () => {
    const input = roiInput(); input.appointments[0].clinicorpAppointmentId = "remote";
    const r = calculateMonthlyMetrics(input); expect(r.attendanceUnknown).toBe(1); expect(r.roiPercent).toBeNull();
  });
});
describe("competência, fusos e validação", () => {
  it("setembro tem limites locais e prazo em 5 de outubro", () => {
    const w = monthlyWindow("2026-09", "America/Sao_Paulo");
    expect(w.start.toISOString()).toBe("2026-09-01T03:00:00.000Z"); expect(w.end.toISOString()).toBe("2026-10-01T03:00:00.000Z");
    expect(w.dueAt.toISOString()).toBe("2026-10-05T03:00:00.000Z"); expect(w.previousMonth).toBe("2026-08");
  });
  it("padrão é mês anterior e janeiro recua para dezembro", () => {
    expect(monthKey(undefined, new Date("2027-01-10T12:00:00Z"))).toBe("2026-12");
  });
  it("almoço, domingo e fronteira de fim do expediente são fora", () => {
    const config = roiConfig(); config.humanHours![1] = [{ start: 540, end: 720 }, { start: 780, end: 1080 }];
    expect(outsideHumanHours(new Date("2026-09-14T15:00:00Z"), config)).toBe(true);
    expect(outsideHumanHours(new Date("2026-09-14T12:00:00Z"), config)).toBe(false);
    expect(outsideHumanHours(new Date("2026-09-14T21:00:00Z"), config)).toBe(true);
    expect(outsideHumanHours(new Date("2026-09-13T15:00:00Z"), config)).toBe(true);
  });
  it("recusa intervalos sobrepostos, centavos fracionados e conversão acima de 100%", () => {
    const config = roiConfig(); config.humanHours![1].push({ start: 600, end: 660 });
    expect(monthlyAssumptionsSchema.safeParse(config).success).toBe(false);
    expect(monthlyAssumptionsSchema.safeParse({ ...roiConfig(), investmentCents: 0.5 }).success).toBe(false);
    expect(monthlyAssumptionsSchema.safeParse({ ...roiConfig(), procedures: [{ name: "Teste", ticketCents: 100, conversionBps: 10_001 }] }).success).toBe(false);
    expect(monthlyAssumptionsSchema.safeParse({ ...roiConfig(), completedStatusTypes: ["CONFIRMED"] }).success).toBe(false);
  });
  it("config antiga ou corrompida nunca lança nem inventa premissas", () => {
    expect(parseMonthlyAssumptions(null)).toEqual(EMPTY_ASSUMPTIONS); expect(parseMonthlyAssumptions({ humanHours: "bad" }).investmentCents).toBeNull();
  });
});
describe("PDF mensal", () => {
  it("gera exatamente uma página A4 com acentos e textos de revisão", async () => {
    const doc = await PDFDocument.load(await generateMonthlyPdf(roiFixture()));
    expect(doc.getPageCount()).toBe(1); expect(doc.getPage(0).getSize().width).toBeCloseTo(595.28);
  });
  it("comporta 12 procedimentos e os limites dos textos", async () => {
    const report = roiFixture();
    report.adjustments = "Revisamos a abordagem do agente e conferimos as informações. ".repeat(7).slice(0, 400);
    report.nextMonth = report.adjustments;
    report.assumptions.procedures = Array.from({ length: 12 }, (_, i) => ({ name: `Procedimento de avaliação com nome extenso e referência ${i}`, ticketCents: 100_000, conversionBps: 5000 }));
    expect((await PDFDocument.load(await generateMonthlyPdf(report))).getPageCount()).toBe(1);
  });
});
