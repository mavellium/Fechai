import { describe, expect, it } from "vitest";
import { applyMonthlyOverrides } from "@/modules/reports/monthly-overrides";
import {
  buildPendencyBoard, buildPendencyRequest, detectMonthlyPendencies, requestableRows, whatsappNumber,
  type PendencyTracking,
} from "@/modules/reports/monthly-pendencies";
import type { MonthlyAssumptions } from "@/modules/reports/monthly-config";
import { roiConfig, roiFixture } from "./fixtures/monthly-roi";

const due = new Date("2026-10-05T03:00:00Z");
const before = new Date("2026-10-01T12:00:00Z");
function incomplete(): { config: MonthlyAssumptions; metrics: ReturnType<typeof applyMonthlyOverrides> } {
  const config = { ...roiConfig(), humanHours: null, attendantMonthlyCents: null, investmentCents: null,
    procedures: [{ name: "Implante", ticketCents: null, conversionBps: 3000 }] };
  const metrics = applyMonthlyOverrides(roiFixture().current, { attendanceUnknown: 2, untypedAppointments: 1 }, config);
  return { config, metrics };
}
const board = (tracking: PendencyTracking[] = []) => {
  const { config, metrics } = incomplete();
  return buildPendencyBoard({ metrics, config, monthName: "setembro", tracking });
};
const row = (rows: ReturnType<typeof board>, topic: string) => rows.find((r) => r.topic === topic)!;

describe("central de pendências do relatório mensal", () => {
  it("é a mesma regra do fechamento: missing sai de detectMonthlyPendencies", () => {
    const { config, metrics } = incomplete();
    expect(metrics.missing).toEqual(detectMonthlyPendencies(metrics, config).map((p) => p.text));
    expect(metrics.revenueCents).toBeNull();
    expect(metrics.roiPercent).toBeNull();
  });

  it("sem pendência de receita, a receita é calculada mesmo faltando economia", () => {
    const config = { ...roiConfig(), attendantMonthlyCents: null };
    const metrics = applyMonthlyOverrides(roiFixture().current, {}, config);
    expect(metrics.missing).toHaveLength(1);
    expect(metrics.revenueCents).not.toBeNull();
    expect(metrics.savingsCents).toBeNull();
  });

  it("revisão completa: todos os tópicos confirmados e nada a solicitar", () => {
    const report = roiFixture();
    const rows = buildPendencyBoard({ metrics: applyMonthlyOverrides(report.current, {}, roiConfig()), config: roiConfig(), monthName: "setembro", tracking: [] });
    expect(rows.every((r) => r.status === "confirmed")).toBe(true);
    expect(buildPendencyRequest({ rows, clinicName: "Clínica", contactName: null, monthLabel: "setembro de 2026", dueAt: due, now: before, timezone: "America/Sao_Paulo", format: "whatsapp" })).toBe("");
  });

  it("agrupa por responsável e diz quais métricas cada pendência afeta", () => {
    const rows = board();
    expect(rows.map((r) => r.owner)).toEqual([...rows.map((r) => r.owner)].sort((a, b) =>
      ["reception", "agenda", "finance", "mavellium"].indexOf(a) - ["reception", "agenda", "finance", "mavellium"].indexOf(b)));
    expect(row(rows, "hours")).toMatchObject({ ownerLabel: "Recepção", status: "confirm" });
    expect(row(rows, "hours").affects).toContain("Receita estimada");
    expect(row(rows, "classification")).toMatchObject({ ownerLabel: "Agenda", status: "check" });
    expect(row(rows, "team").affects).toEqual(["Economia estimada", "ROI do mês"]);
    expect(row(rows, "investment")).toMatchObject({ title: "Mensalidade de setembro", ownerLabel: "Mavellium", askedFromClinic: false });
  });

  it("pedido e resposta mudam o status, mas a pendência só some quando o dado entra na revisão", () => {
    const requestedAt = new Date("2026-10-01T10:00:00Z");
    const t = (topic: string, over: Partial<PendencyTracking> = {}): PendencyTracking =>
      ({ topic, assignee: "", requestedAt, requestedVia: "whatsapp", answer: "", answeredAt: null, ...over });
    const rows = board([t("hours"), t("ticket", { answer: "Implante R$ 8 mil", answeredAt: new Date("2026-10-02T10:00:00Z") }),
      t("attendance", { answer: "antiga", answeredAt: new Date("2026-09-30T10:00:00Z") })]);
    expect(row(rows, "hours").status).toBe("requested");
    expect(row(rows, "ticket").status).toBe("answered");
    // Resposta anterior ao último pedido não conta como resposta a este pedido.
    expect(row(rows, "attendance").status).toBe("requested");
  });

  it("solicitação consolidada: uma mensagem, por área, sem os tópicos da Mavellium nem dado de paciente", () => {
    const rows = board([{ topic: "hours", assignee: "Ana", requestedAt: null, requestedVia: null, answer: "", answeredAt: null }]);
    const text = buildPendencyRequest({ rows, clinicName: "Instituto do Sorriso", contactName: "Paula Souza", monthLabel: "setembro de 2026",
      dueAt: due, now: before, timezone: "America/Sao_Paulo", format: "whatsapp" });
    expect(text).toContain("Olá, Paula!");
    expect(text).toContain("até 05/10");
    expect(text).toContain("*Recepção (Ana)*");
    expect(text).toContain("*Financeiro*");
    expect(text).toContain("Implante");
    expect(text).not.toContain("Mensalidade");
    expect(text).not.toContain("Conferência dos indicadores");
    expect(text.match(/^\d+\. /gm)).toHaveLength(requestableRows(rows).length);
    const email = buildPendencyRequest({ rows, clinicName: "Instituto do Sorriso", contactName: null, monthLabel: "setembro de 2026",
      dueAt: due, now: new Date("2026-10-06T12:00:00Z"), timezone: "America/Sao_Paulo", format: "email" });
    expect(email).not.toContain("*");
    expect(email).toContain("o quanto antes");
  });

  it("telefone do cadastro vira número do wa.me só quando é confiável", () => {
    expect(whatsappNumber("11987654321")).toBe("5511987654321");
    expect(whatsappNumber("(11) 3456-7890")).toBe("551134567890");
    expect(whatsappNumber("5511987654321")).toBe("5511987654321");
    expect(whatsappNumber("12345")).toBeNull();
    expect(whatsappNumber(null)).toBeNull();
  });
});
