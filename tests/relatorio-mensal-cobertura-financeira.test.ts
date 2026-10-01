import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/modules/scheduling/clinicorp", () => ({ readClinicorpReport: vi.fn() }));
import { evaluateMonthlyMetrics, type MonthlyReport } from "@/modules/reports/monthly";
import { validateMonthlyReport } from "@/modules/reports/monthly-validate";
import { monthlyFinancialPresentation } from "@/modules/reports/monthly-data";
import { MonthlyReportDocument } from "@/app/(dashboard)/relatorios/monthly-v2/MonthlyReportDocument";
import { local, v2Input } from "./fixtures/monthly-report-v2";

const complete = () => {
  const input = v2Input();
  input.appointments = input.appointments.filter((a) => a.startsAt <= input.now && a.attendance !== "unknown");
  return input;
};
const data = (input = v2Input()) => evaluateMonthlyMetrics(input).data;
const report = (input = v2Input(), extra: Partial<MonthlyReport> = {}) => ({
  month: "2026-09", label: "setembro de 2026", previousMonth: "2026-08", tenantName: "Clínica de teste", status: "draft",
  assumptions: input.config, data: data(input), agentChanges: [], nextActions: [], limitations: [], ...extra,
}) as MonthlyReport;
const text = (r: MonthlyReport) => renderToStaticMarkup(createElement(MonthlyReportDocument, { report: r, print: true })).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("cobertura financeira antes da entrega", () => {
  it("zero comparecimentos não dispensa ticket e conversão", () => {
    const input = complete(); input.config.financialEnabled = true;
    input.appointments = []; input.config.procedures = [{ name: "Implante", ticketCents: null, conversionBps: null }];
    const d = data(input);
    expect(d.estimatedReturn).toBeNull();
    expect(d.financialSummary).toMatchObject({ status: "incomplete", revenueCents: null, investmentCents: 149000 });
    expect(d.financialSummary?.savingsCents).toBeGreaterThan(0);
    const out = text(report(input));
    expect(out).toContain("Receita potencial de tratamentos Não calculável");
    expect(out).toContain("ROI total Indisponível");
    expect(out).not.toContain("Tratamentos potenciais R$ 0");
  });
  it("comparecimentos fora do expediente não verificados ou futuros não geram ROI", () => {
    const d = data();
    expect(d.estimatedReturn).toBeNull();
    expect(d.financialSummary?.revenueCents).toBeNull();
    expect(d.financialSummary?.warnings).toEqual(expect.arrayContaining([
      "Há comparecimentos sem verificação na base do retorno financeiro.", "Há avaliações futuras na base do retorno financeiro.",
    ]));
  });
  it("desligar financeiro remove tudo mesmo com premissas completas", () => {
    const input = complete(); input.config.financialEnabled = false;
    const d = data(input);
    expect(d.estimatedReturn).toBeNull(); expect(d.financialSummary).toBeNull(); expect(d.estimatedReturnMissing).toEqual([]);
    expect(text(report(input))).not.toContain("ROI total");
  });
  it("padrão visual de 30 segundos não comprova economia", () => {
    const input = complete(); input.config.secondsPerMessage = null;
    const d = data(input);
    expect(d.financialSummary?.savingsCents).toBeNull(); expect(d.estimatedReturn).toBeNull();
    expect(d.financialSummary?.revenueCents).toBe(896000);
  });
  it("premissas completas e base resolvida permitem receita zero e ROI negativo reais", () => {
    const input = complete(); input.appointments = [];
    const d = data(input);
    expect(d.estimatedReturn?.revenueCents).toBe(0);
    expect(d.estimatedReturn?.multiple).toBeLessThan(0);
  });
  it("resumo não apresenta economia contra mensalidade como ROI total", () => {
    const r = report();
    const keys = (highlights: string) => validateMonthlyReport(r.data!, { decisionMaker: "Dono", operationalContact: "Agenda", highlights, month: "2026-09" }).map((issue) => issue.key);
    expect(keys("ROI total de −0,7x.")).toContain("financial_claim");
    expect(keys("ROI total indisponível. Economia operacional estimada de R$ 242.")).not.toContain("financial_claim");
  });
  it("snapshot antigo inseguro não reapresenta o ROI e não é modificado", () => {
    const input = complete(); const d = data(input); delete d.financialSummary;
    d.schedule.cohort.unverified.outside.value = 3;
    const before = JSON.stringify(d);
    const view = monthlyFinancialPresentation(d, input.config);
    expect(view.estimatedReturn).toBeNull(); expect(view.financialSummary?.revenueCents).toBeNull();
    expect(view.financialSummary?.savingsCents).toBe(d.estimatedReturn?.savingsCents);
    expect(JSON.stringify(d)).toBe(before);
  });
});

describe("leitura do relatório", () => {
  it("prazo humano inclui quem não respondeu no denominador e respeita a meta da clínica", () => {
    const input = v2Input(); input.config.receptionTargetMinutes = 30;
    const reception = data(input).service.reception;
    expect(reception.withinHourPercent?.value).toBe(75.9); // 44 / 58
    expect(reception.withinTargetPercent?.value).toBe(75.9);
    expect(reception.countedUntil).toBe(input.end.toISOString());
    const noTarget = data().service.reception;
    expect(noTarget.targetMinutes).toBeNull(); expect(noTarget.withinTargetPercent?.value).toBeNull();
  });
  it("não conta resposta humana depois da borda do mês", () => {
    const input = v2Input();
    const contact = input.conversations[0];
    input.events.push({ id: "transfer-at-end", kind: "handoff", conversationId: contact.id, procedure: null, createdAt: local(30, 23) });
    contact.messages.push({ id: "after-cutoff", role: "assistant", sentBy: "human", createdAt: input.end });
    expect(data(input).service.reception.unanswered.value).toBe(4);
  });
  it("chegadas por dia fecham na população e respeitam dias sem recepção", () => {
    const input = v2Input(); input.config.humanClosedDates = ["2026-09-01"];
    const d = data(input);
    const arrivals = d.service.arrivalsByWeekday!;
    expect(arrivals.reduce((sum, row) => sum + row.inside + row.outside + row.unclassified, 0)).toBe(214);
    expect(arrivals.reduce((sum, row) => sum + row.outside, 0)).toBe(d.service.contacts.outside.value);
    expect(d.leads.population?.notScheduled).toBe(183);
  });
  it("duas avaliações da mesma pessoa não duplicam a população de conversão", () => {
    const input = v2Input(); input.appointments.push({ ...input.appointments[0], id: "second-evaluation" });
    const d = data(input);
    expect(d.schedule.cohort.total.total.value).toBe(32); expect(d.leads.population?.scheduled).toBe(31);
    expect(d.leads.population?.notScheduled).toBe(183);
  });
  it("amostra de sete cidades não caracteriza toda a base", () => {
    const input = v2Input();
    input.conversations.forEach((c, i) => { c.insight = i < 7 ? { city: "Sumaré", cityKey: "sumare", firstQuestionKey: null, lossReasonKey: null } : null; });
    const out = text(report(input));
    expect(out).toContain("Amostra de cidades: 7 respostas de 214 contatos");
    expect(out).toContain("não caracteriza toda a base"); expect(out).toContain("mínimo de 10 respostas");
  });
  it("ações vêm depois dos problemas e mostram o vínculo; alterações só com data e finalidade", () => {
    const out = text(report(v2Input(), {
      adjustments: "Modificações genéricas que não foram conferidas",
      agentChanges: [{ kind: "fixed", text: "Mudança sem documentação", date: null }, { kind: "rule", text: "Ajustado acesso", date: "2026-09-20", purpose: "Esclarecer como chegar" }],
      nextActions: [{ action: "Conferir integração", owner: "Agenda", indicator: "Comparecimentos verificados", reason: "Avaliações sem confirmação no Clinicorp" }],
      limitations: [{ key: "attendance", text: "7 avaliações sem comparecimento confirmado", affects: ["Compareceram"] }],
    }));
    expect(out).not.toContain("Mudança sem documentação"); expect(out).not.toContain("Modificações genéricas");
    expect(out).toContain("20/09/2026 · Ajustado acesso"); expect(out).toContain("Finalidade: Esclarecer como chegar");
    expect(out).toContain("Motivo: Avaliações sem confirmação no Clinicorp");
    expect(out.indexOf("Próximo mês")).toBeGreaterThan(out.indexOf("7 avaliações sem comparecimento confirmado"));
  });
});
