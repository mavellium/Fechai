import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/modules/scheduling/clinicorp", () => ({ readClinicorpReport: vi.fn() }));
import { PDFDocument } from "pdf-lib";
import { generateMonthlyPdf } from "@/modules/reports/monthly-pdf";
import { applyMonthlyOverrides } from "@/modules/reports/monthly-overrides";
import { monthlyQuality, QUALITY_LABEL } from "@/modules/reports/monthly-quality";
import { HIGHLIGHTS_MAX, LIMITATIONS_NOTE_MAX, limitationFingerprint, monthlyLimitations, sameLimitations, unverifiedMetrics } from "@/modules/reports/monthly-limitations";
import { guardMonthlyAnalysis, monthlyAnalysisFacts, monthlyAnalysisMessages, unbackedNumbers } from "@/modules/reports/monthly-analysis";
import type { MonthlyReport } from "@/modules/reports/monthly";
import { summarizeLeadQuality } from "@/modules/lead-insights/summary";
import { roiFixture } from "./fixtures/monthly-roi";

/** O relatório como `computeMonthlyReport` o devolve: selo e limitações calculados. */
function withLimitations(report: MonthlyReport): MonthlyReport {
  report.current = applyMonthlyOverrides(report.automatic?.current ?? report.current, report.metricOverrides?.current ?? {}, report.assumptions);
  report.quality = monthlyQuality(report);
  report.limitations = monthlyLimitations(report);
  return report;
}
const partial = () => {
  const report = roiFixture();
  // Premissa financeira só é limitação com o retorno estimado ligado.
  report.assumptions = { ...report.assumptions, financialEnabled: true, attendantMonthlyCents: null };
  return withLimitations(report);
};

describe("limitações do fechamento", () => {
  it("cada pendência vira limitação, com o que ela afeta; relatório completo não tem nenhuma", () => {
    expect(withLimitations(roiFixture()).limitations).toEqual([]);
    const r = partial();
    expect(r.limitations?.map((l) => l.key)).toEqual(["team"]);
    expect(r.limitations?.[0].affects).toEqual(["Economia estimada", "ROI do mês"]);
    expect(r.current.missing).toEqual(r.limitations?.map((l) => l.text));
  });
  it("sem expediente, dentro/fora é uma limitação só, sem repetir a chegada sem horário", () => {
    const report = roiFixture();
    report.assumptions = { ...report.assumptions, humanHours: null };
    const keys = withLimitations(report).limitations?.map((l) => l.key);
    expect(keys).toContain("hours"); expect(keys).not.toContain("arrival");
  });
  it("cobertura sem pendência também é limitação: histórico, Clinicorp e áudio sem duração", () => {
    const report = roiFixture();
    report.clinicorpError = "Clinicorp indisponível"; report.clinicorpIntegrationState = "configured";
    report.automatic!.current = { ...report.automatic!.current, trackingComplete: false, time: { ...report.automatic!.current.time!, unmeasuredAudios: 2 } };
    const keys = withLimitations(report).limitations?.map((l) => l.key);
    expect(keys).toEqual(expect.arrayContaining(["tracking", "clinicorp", "audio"]));
  });
  it("número sem dado sai como não verificado, nunca como pendente", () => {
    const r = partial();
    expect(unverifiedMetrics(r)).toEqual(["Economia estimada", "ROI do mês"]);
    expect(QUALITY_LABEL[r.quality!.savings!.status]).toBe("Não verificado");
  });
  it("confirmação vale para a lista exata: contagem nova pede confirmar de novo", () => {
    const r = partial();
    const seen = limitationFingerprint(r.limitations!);
    expect(sameLimitations(seen, r.limitations!)).toBe(true);
    expect(sameLimitations(seen, [{ ...r.limitations![0], text: `${r.limitations![0].text} Outra coisa.` }])).toBe(false);
    expect(sameLimitations([], r.limitations!)).toBe(false);
    expect(sameLimitations([], [])).toBe(true);
  });
});

describe("PDF com limitações e destaques", () => {
  const pages = async (r: MonthlyReport) => (await PDFDocument.load(await generateMonthlyPdf(r))).getPageCount();
  it("página 1 é o resumo executivo e o detalhe vem depois, com ou sem limitações", async () => {
    expect(await pages(withLimitations(roiFixture()))).toBeGreaterThanOrEqual(2);
    const r = partial(); r.status = "ready"; r.limitationsNote = "O custo da recepção não foi informado a tempo.";
    expect(await pages(r)).toBeGreaterThanOrEqual(2);
  });
  it("página 1 cabe com conteúdo máximo: resumo e três ações no limite e a linha de limitações", async () => {
    const r = partial(); r.status = "ready";
    r.agentNames = Array.from({ length: 5 }, (_, i) => `Agente de atendimento com nome extenso ${i}`);
    r.adjustments = "Revisamos a abordagem do agente e conferimos as informações. ".repeat(7).slice(0, 400);
    r.nextMonth = r.adjustments;
    r.highlights = "Foram 1.234 conversas respondidas, 40% fora do expediente, e 18 avaliações realizadas de quem chegou à noite. ".repeat(8).slice(0, HIGHLIGHTS_MAX);
    // Três ações no limite de cada campo: a página 1 tem de comportar as três.
    r.nextActions = Array.from({ length: 3 }, (_, i) => ({ action: `Ação prioritária número ${i} com texto bem extenso para ocupar duas linhas no quadro `.repeat(2).slice(0, 120),
      owner: "Responsável com nome de área bem comprido para testar o limite ".slice(0, 60), indicator: "Indicador de acompanhamento com descrição longa o bastante para quebrar a linha ".repeat(2).slice(0, 100) }));
    r.limitationsNote = "Explicação longa das limitações do mês. ".repeat(12).slice(0, LIMITATIONS_NOTE_MAX);
    r.assumptions.procedures = Array.from({ length: 12 }, (_, i) => ({ name: `Procedimento de avaliação com nome extenso e referência ${i}`, ticketCents: 100_000, conversionBps: 5000 }));
    r.featuredCase = "Uma paciente de 74 anos enviou 2 áudios de quase 5 minutos. ".repeat(6).slice(0, 240);
    Object.assign(r, withLimitations(r));
    // Estourar a página 1 lança erro; gerar prova que coube.
    expect(await pages(r)).toBeGreaterThanOrEqual(2);
  });
  it("leads entram na análise detalhada sem mexer na página 1", async () => {
    const r = partial();
    const without = await pages(r);
    r.leadQuality = summarizeLeadQuality([{ createdAt: new Date("2026-09-10T12:00:00Z"), status: "new", disqualified: false, disqualifiedReason: null,
      conversation: { needsHuman: false, lastInboundAt: new Date("2026-09-10T13:00:00Z"), followUpReason: null, handoffEvents: 0 }, appointments: [], insight: null }], null, new Date("2026-10-05T12:00:00Z"));
    expect(await pages(r)).toBeGreaterThanOrEqual(without);
  });
});

describe("análise do mês pela IA", () => {
  const analysis = { highlights: "Destaque", limitationsNote: "Faltou o custo.", adjustments: "Mudamos o tom.", nextActions: [{ action: "Levantar o custo.", owner: "Financeiro", indicator: "Economia estimada" }], notes: "" };
  it("não inventa melhoria sem registro nem problema sem incidente comprovado", () => {
    const guarded = guardMonthlyAnalysis(analysis, { limitations: 0, incidents: 0, hasFacts: false });
    expect(guarded.adjustments).toBe(""); expect(guarded.notes).toContain("melhorias executadas");
    // Sem incidente, limitação nem contexto do admin, o texto da IA sai: a seção dirá que não houve incidente.
    expect(guarded.limitationsNote).toBe(""); expect(guarded.notes).toContain("Nenhum incidente relevante identificado");
    // Com algo comprovado (ou contado pelo admin), o texto fica como veio.
    expect(guardMonthlyAnalysis(analysis, { limitations: 1, hasFacts: true })).toEqual(analysis);
    expect(guardMonthlyAnalysis(analysis, { limitations: 0, incidents: 2, hasFacts: true }).limitationsNote).toBe(analysis.limitationsNote);
    expect(guardMonthlyAnalysis(analysis, { limitations: 0, incidents: 0, hasContext: true, hasFacts: true }).limitationsNote).toBe(analysis.limitationsNote);
    // Em branco não é mais erro: nada de aviso pedindo para preencher.
    expect(guardMonthlyAnalysis({ ...analysis, limitationsNote: "" }, { limitations: 0, hasFacts: true }).notes).toBe("");
  });
  it("a IA só redige: número que não está nos dados validados é apontado para conferência", () => {
    const validated = JSON.stringify({ lede: "Em setembro, o Fechai atendeu 214 contatos e marcou 31 avaliações.", rate: "78%", money: { revenueCents: 896_000 }, hours: "9h40" });
    expect(unbackedNumbers("Foram 214 contatos e 31 avaliações, 78% de comparecimento e R$ 8.960 de receita em 9h40.", validated)).toEqual([]);
    expect(unbackedNumbers("Foram 214 contatos, 45 a mais que o esperado, com 92% de satisfação.", validated)).toEqual(["45", "92"]);
    const guarded = guardMonthlyAnalysis({ ...analysis, highlights: "Foram 214 contatos e 92% de satisfação." }, { limitations: 1, hasFacts: true, validated });
    expect(guarded.notes).toContain("Números sem origem nos dados validados: 92");
    expect(guarded.highlights).toContain("92%");
  });
  it("a IA recebe as frases e tabelas já validadas pelo motor, os incidentes e as ações do mês anterior", () => {
    const r = roiFixture();
    r.previousActions = [{ action: "Lembrete na véspera", owner: "Mavellium", indicator: "Faltas", status: "worked", result: "Faltas caíram de 31% para 22%." }];
    const draft = { assumptions: r.assumptions, metricOverrides: { current: {}, previous: {} }, adjustments: "", nextMonth: "", decisionMaker: "", highlights: "", limitationsNote: "", nextActions: [] };
    const facts = monthlyAnalysisFacts(r, draft, []);
    expect(facts.incidents).toEqual([]);
    expect(facts.validated.lede).toContain("o Fechai atendeu 1 contato");
    expect(facts.validated.tables.map((t) => t.title)).toContain("Funil do mês");
    expect(facts.previousActions[0]).toEqual({ action: "Lembrete na véspera", status: "worked", result: "Faltas caíram de 31% para 22%." });
    const [system] = monthlyAnalysisMessages(r, draft, [], "");
    expect(String(system.content)).toContain("NUNCA invente, suponha ou exagere um problema");
    expect(String(system.content)).toContain("NÃO calcule");
  });
  it("com o retorno estimado desligado, a IA não recebe dinheiro e é avisada para não citar", () => {
    const r = roiFixture();
    r.assumptions = { ...r.assumptions, procedures: [] };
    const draft = { assumptions: r.assumptions, metricOverrides: { current: {}, previous: {} }, adjustments: "", nextMonth: "", decisionMaker: "", highlights: "", limitationsNote: "", nextActions: [] };
    const [system] = monthlyAnalysisMessages(r, draft, [], "");
    const facts = JSON.parse(String(system.content).split("FATOS: ")[1]);
    expect(facts.financial).toBe(false); expect(facts.money).toBeUndefined();
    expect(facts.current.scheduled).toBeDefined(); expect(facts.anchor.attended).toBeDefined();
    expect(String(system.content)).toContain("NÃO mencione ROI");
  });
  it("a IA recebe agregados, selo, limitações e alterações do agente; nada de registro individual", () => {
    const r = partial();
    const draft = { assumptions: r.assumptions, metricOverrides: { current: {}, previous: {} }, adjustments: "", nextMonth: "", decisionMaker: "", highlights: "", limitationsNote: "", nextActions: [] };
    const [system] = monthlyAnalysisMessages(r, draft, [{ label: "Alterou as regras do agente", target: "Agente A", count: 2, lastAt: "2026-09-10T12:00:00.000Z" }], "");
    const facts = JSON.parse(String(system.content).split("FATOS: ")[1]);
    expect(facts.unverified).toEqual(["Economia estimada", "ROI do mês"]);
    expect(facts.limitations[0].affects).toContain("Economia estimada");
    expect(facts.quality.savings).toBe("pending");
    expect(facts.agentChanges[0].target).toBe("Agente A");
    expect(String(system.content)).not.toContain("conversationId");
  });
});
