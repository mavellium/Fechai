import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/modules/scheduling/clinicorp", () => ({ readClinicorpReport: vi.fn() }));
import { MonthlyReportDocument } from "@/app/(dashboard)/relatorios/monthly-v2/MonthlyReportDocument";
import { evaluateMonthlyMetrics, type MonthlyInput, type MonthlyReport } from "@/modules/reports/monthly";
import { formatSpan, hoursLabel, openingSentence, problemText } from "@/modules/reports/monthly-format";
import { allowedNumbers, hasFullDate, unknownNumbers } from "@/modules/reports/monthly-text-guard";
import { guardMonthlyAnalysis } from "@/modules/reports/monthly-analysis";
import { blockingIssues, validateMonthlyReport } from "@/modules/reports/monthly-validate";
import { monthlyPdfFilename } from "@/modules/reports/monthly-print";
import { signPrintToken, verifyPrintToken } from "@/lib/print-token";
import { v2Config, v2Input } from "./fixtures/monthly-report-v2";

function report(input: MonthlyInput = v2Input(), over: Partial<MonthlyReport> = {}): MonthlyReport {
  const { metrics, data } = evaluateMonthlyMetrics(input);
  return { version: 1, tenantName: "Clínica Exemplo Odonto", month: "2026-09", label: "setembro de 2026", previousMonth: "2026-08",
    assumptions: input.config, current: metrics, previous: metrics, data, status: "ready", decisionMaker: "Dr. Rafael Teixeira", decisionMakerRole: "partner",
    operationalContact: "recepção", adjustments: "", nextMonth: "", highlights: "", limitationsNote: "", meetingAt: null, sentAt: null, finalizedAt: null,
    nextActions: [{ action: "Segundo lembrete no dia da consulta.", owner: "Mavellium", indicator: "faltas abaixo de 15%" }], ...over } as unknown as MonthlyReport;
}
const html = (r: MonthlyReport, print = true) => renderToStaticMarkup(createElement(MonthlyReportDocument, { report: r, print }));
const text = (r: MonthlyReport) => html(r).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("documento do relatório mensal v2", () => {
  it("mostra os números do motor na ordem de leitura do decisor", () => {
    const out = text(report());
    expect(out).toContain("Em setembro, o Fechai atendeu 214 contatos e marcou 31 avaliações. 21 pacientes já compareceram. 88 contatos chegaram com a recepção fechada");
    expect(out).toContain("126 no expediente · 88 fora");
    expect(out).toContain("78% das consultas já realizadas");
    expect(out).toContain("9h40"); expect(out).toContain("R$ 7.712"); expect(out).toContain("5,2x");
    expect(out).toContain("Dr. Rafael Teixeira (sócio)"); expect(out).toContain("seg a sex 8h–18h, sáb 8h–12h");
    expect(out.indexOf("Próximo mês")).toBeLessThan(out.indexOf("Atendimento"));
    expect(text({ ...report() }).length).toBeGreaterThan(0);
  });
  it("na tela, as próximas ações ficam no fim e o retorno estimado por último", () => {
    const out = html(report(), false).replace(/<[^>]+>/g, " ");
    expect(out.indexOf("Próximo mês")).toBeGreaterThan(out.indexOf("O que não saiu como planejado"));
    expect(out.indexOf("Retorno estimado")).toBeGreaterThan(out.indexOf("Próximo mês"));
  });
  it("sem premissa financeira, o PDF não fala em ROI, retorno nem pendente (D4)", () => {
    const input = v2Input();
    input.config.procedures = []; input.config.attendantMonthlyCents = null;
    const out = text(report(input));
    for (const word of ["ROI", "Retorno", "retorno", "Pendente", "pendente"]) expect(out).not.toContain(word);
    expect(out).toContain("214");
  });
  it("não leva nota interna nem texto de componente de admin", () => {
    const out = text(report());
    for (const word of ["Nota interna", "Salvar revisão", "Ver registros", "Recalcular", "Perguntar à I.A"]) expect(out).not.toContain(word);
  });
  it("sem incidente comprovado, diz que não houve (D9)", () => {
    const input = v2Input();
    input.incidents = []; input.appointments = []; input.events = [];
    for (const c of input.conversations) c.messages = c.messages.filter((m) => m.sentBy !== "human");
    expect(text(report(input))).toContain("Nenhum incidente relevante identificado neste mês.");
  });
  it("sem expediente cadastrado mostra só o total, sem quebra inventada", () => {
    const input = v2Input(); input.config.humanHours = null;
    const out = text(report(input));
    expect(out).not.toContain("no expediente ·"); expect(out).not.toContain("Expediente humano");
  });
});

describe("formatação do relatório mensal v2", () => {
  it("durações como o relatório fala", () => {
    expect([38, 1320, 372, 7500, 34800, 10800].map(formatSpan)).toEqual(["38 s", "22 min", "6min12", "2h05", "9h40", "3h"]);
  });
  it("expediente em uma linha", () => {
    expect(hoursLabel(v2Config().humanHours)).toBe("seg a sex 8h–18h, sáb 8h–12h");
    expect(hoursLabel(null)).toBeNull();
  });
  it("problemas saem dos dados, com as contagens", () => {
    const data = evaluateMonthlyMetrics(v2Input()).data;
    const titles = data.problems.map((p) => problemText(p, "America/Sao_Paulo").title);
    expect(titles[0]).toBe("6 faltas (22% das consultas já realizadas).");
    expect(titles[1]).toBe("O agente ficou 3h fora do ar em 17/09, das 19h às 22h.");
    expect(titles[2]).toBe("11 conversas passadas para a recepção esperaram mais de 1 hora, e 3 seguiam sem resposta no fim do mês.");
    expect(openingSentence("setembro", data)).toContain("214 contatos");
  });
  it("nome do arquivo com clínica, mês e versão", () => {
    expect(monthlyPdfFilename("Clínica Exemplo Odonto", "2026-09", 2, false)).toBe("fechai-relatorio-clinica-exemplo-odonto-2026-09-v2.pdf");
    expect(monthlyPdfFilename("Clínica", "2026-09", 0, true)).toBe("fechai-relatorio-clinica-2026-09-rascunho.pdf");
  });
});

describe("guardas dos textos da IA", () => {
  const data = evaluateMonthlyMetrics(v2Input()).data;
  const allowed = allowedNumbers(data, { month: "2026-09", previousMonth: "2026-08" });
  it("aceita os números do motor em qualquer forma em que o relatório os mostra", () => {
    expect(unknownNumbers("Em setembro o agente atendeu 214 contatos, marcou 31 avaliações (78% de comparecimento, 22% de faltas), devolveu 9h40 e respondeu em 38 s. A recepção levou 22 minutos. Retorno estimado de R$ 7.712, 5,2x. Atende 24h por dia.", allowed)).toEqual([]);
  });
  it("recusa número que o motor não calculou", () => {
    expect(unknownNumbers("O agente atendeu 277 contatos e gerou R$ 12.345.", allowed)).toEqual(["277", "12.345"]);
    const guarded = guardMonthlyAnalysis({ highlights: "Foram 277 contatos.", limitationsNote: "", adjustments: "", nextActions: [], notes: "" },
      { limitations: 0, hasFacts: true, unknownNumbers: (t) => unknownNumbers(t, allowed) });
    expect(guarded.highlights).toBe(""); expect(guarded.notes).toContain("277");
  });
  it("o fechamento bloqueia resumo com número sem origem e texto com data completa", () => {
    const texts = { decisionMaker: "Dr. Rafael", operationalContact: "Recepção", month: "2026-09", previousMonth: "2026-08" };
    const keys = (extra: object) => blockingIssues(validateMonthlyReport(data, { ...texts, ...extra })).map((i) => i.key);
    expect(keys({ highlights: "O agente atendeu 214 contatos." })).toEqual([]);
    expect(keys({ highlights: "O agente atendeu 277 contatos." })).toEqual(["text_numbers"]);
    expect(keys({ featuredCase: "Uma paciente de 76 anos escreveu em 12/09 à noite." })).toEqual(["text_date"]);
    expect(hasFullDate("num sábado à noite")).toBe(false); expect(hasFullDate("no dia 12 de setembro")).toBe(true);
  });
});

describe("token de impressão", () => {
  it("vale só assinado, para aquela conta e mês, por poucos minutos", () => {
    vi.stubEnv("AUTH_SECRET", "0123456789012345678901234567890123456789");
    const token = signPrintToken({ tenantId: "t", month: "2026-09", draft: false }, 1000);
    expect(verifyPrintToken(token, 2000)).toMatchObject({ tenantId: "t", month: "2026-09", draft: false });
    expect(verifyPrintToken(token, 1000 + 6 * 60_000)).toBeNull();
    const [raw, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ tenantId: "other", month: "2026-09", draft: true, exp: 9e15 })).toString("base64url");
    expect(verifyPrintToken(`${forged}.${sig}`, 2000)).toBeNull();
    expect(verifyPrintToken(`${raw}.00`, 2000)).toBeNull(); expect(verifyPrintToken(undefined)).toBeNull();
    vi.unstubAllEnvs();
  });
});
