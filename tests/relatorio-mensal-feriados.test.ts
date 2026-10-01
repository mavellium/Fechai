import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/modules/scheduling/clinicorp", () => ({ readClinicorpReport: vi.fn() }));
import { humanClosedDatesFromText, monthlyAssumptionsSchema, outsideHumanHours, parseMonthlyAssumptions } from "@/modules/reports/monthly-config";
import { arrivalSlot } from "@/modules/reports/monthly-operations";
import { evaluateMonthlyMetrics, type MonthlyReport } from "@/modules/reports/monthly";
import { humanClosedDatesLabel } from "@/modules/reports/monthly-format";
import { MonthlyReportDocument } from "@/app/(dashboard)/relatorios/monthly-v2/MonthlyReportDocument";
import { monthlyAgentSource } from "@/modules/reports/monthly-import";
import { local, v2Config, v2Input } from "./fixtures/monthly-report-v2";

describe("dias sem recepção nas premissas do relatório", () => {
  it("lê revisões antigas sem perder as premissas já preenchidas", () => {
    const { humanClosedDates: _dates, ...old } = v2Config();
    void _dates;
    const c = parseMonthlyAssumptions(old);
    expect(c.humanClosedDates).toEqual([]);
    expect(c.humanHours).toEqual(old.humanHours);
    expect(c.investmentCents).toBe(149000);
    expect(outsideHumanHours(local(7, 9), c)).toBe(false);
  });
  it("valida datas civis, duplicatas e limite sem descartar entrada inválida", () => {
    const schema = monthlyAssumptionsSchema.shape.humanClosedDates;
    expect(humanClosedDatesFromText(" 2026-09-07 \r\n\n 2026-09-08 ")).toEqual(["2026-09-07", "2026-09-08"]);
    for (const dates of [["2026-02-29"], ["2026-09-31"], ["07/09/2026"], ["2026-09-07", "2026-09-07"], Array(367).fill("2026-09-07")]) {
      expect(schema.safeParse(dates).success).toBe(false);
    }
    expect(schema.safeParse(["2028-02-29"]).success).toBe(true);
    expect(humanClosedDatesFromText("dia inválido")).toEqual(["dia inválido"]);
  });
  it("dia fechado prevalece sobre a grade semanal, sem presumir expediente ausente", () => {
    const c = { ...v2Config(), humanClosedDates: ["2026-09-07"] };
    expect(outsideHumanHours(local(7, 9), c)).toBe(true);
    expect(arrivalSlot(local(7, 9), c)).toBe("closedDay");
    expect(outsideHumanHours(local(8, 9), c)).toBe(false);
    expect(arrivalSlot(local(8, 9), c)).toBe("inside");
    expect(outsideHumanHours(local(7, 9), { ...c, humanHours: null })).toBeNull();
    expect(arrivalSlot(local(7, 9), { ...c, humanHours: null })).toBe("unclassified");
    expect(arrivalSlot(null, c)).toBe("unclassified");
  });
  it("usa o dia local, inclusive quando UTC está em outro mês", () => {
    const c = { ...v2Config(), humanClosedDates: ["2026-09-30"] };
    // Mesmo instante: 30/09 23h em Brasília, 01/10 02h em UTC.
    const instant = new Date("2026-10-01T02:00:00Z");
    expect(arrivalSlot(instant, c)).toBe("closedDay");
    expect(arrivalSlot(instant, { ...c, timezone: "UTC" })).toBe("beforeOpen");
    expect(arrivalSlot(local(30, 9, 0, 0, 10), c)).toBe("inside");
  });
  it("reclassifica somente o expediente, conservando contatos e avaliações do motor v2", () => {
    const input = v2Input();
    const before = evaluateMonthlyMetrics(input);
    const saved = JSON.stringify(before.data);
    input.config.humanClosedDates = ["2026-09-01"];
    const after = evaluateMonthlyMetrics(input);
    expect(after.data.service.contacts.total.value).toBe(before.data.service.contacts.total.value);
    expect(after.data.schedule.cohort.total.total.value).toBe(before.data.schedule.cohort.total.total.value);
    expect(after.data.service.contacts.outside.value).toBeGreaterThan(before.data.service.contacts.outside.value!);
    expect(after.metrics.arrivals!.closedDay).toBeGreaterThan(before.metrics.arrivals!.closedDay);
    for (const c of after.evidence.contacts!.filter((c) => c.arrivalAt.startsWith("2026-09-01"))) expect(c.bucket).toBe("outside");
    expect(JSON.stringify(before.data)).toBe(saved);
  });
  it("expõe a premissa na mesma folha do painel e da impressão", () => {
    const input = v2Input(); input.config.humanClosedDates = ["2026-09-08", "2026-09-07"];
    const { metrics, data } = evaluateMonthlyMetrics(input);
    const r = { tenantName: "Clínica", month: "2026-09", label: "setembro de 2026", previousMonth: "2026-08", status: "ready",
      assumptions: input.config, current: metrics, previous: metrics, data, nextActions: [], agentChanges: [] } as unknown as MonthlyReport;
    for (const print of [false, true]) {
      const html = renderToStaticMarkup(createElement(MonthlyReportDocument, { report: r, print }));
      expect(html).toContain("Dias sem recepção cadastrados: 07/09/2026 · 08/09/2026");
      expect(html).toContain("Contados como fora do expediente humano");
    }
    expect(humanClosedDatesLabel()).toBeNull();
  });
  it("não transforma bloqueios da agenda do agente em feriados da recepção", () => {
    const source = monthlyAgentSource({ id: "a", name: "Agente", isPrimary: true, archived: false, actions: [{ key: "schedule_meeting",
      config: { workdays: [1, 2, 3, 4, 5], startTime: "08:00", endTime: "18:00", timezone: "America/Sao_Paulo", blockedDates: ["2026-09-07"] } }] });
    expect(source.schedule).not.toBeNull();
    expect(source.schedule).not.toHaveProperty("humanClosedDates");
  });
});
