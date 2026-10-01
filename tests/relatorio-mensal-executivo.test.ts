import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/modules/scheduling/clinicorp", () => ({ readClinicorpReport: vi.fn() }));
import { PDFDocument } from "pdf-lib";
import { evaluateMonthlyMetrics, type MonthlyReport } from "@/modules/reports/monthly";
import { applyMonthlyOverrides } from "@/modules/reports/monthly-overrides";
import { monthlyQuality } from "@/modules/reports/monthly-quality";
import { monthlyLimitations, unverifiedMetrics } from "@/modules/reports/monthly-limitations";
import { NO_INCIDENT, executiveSummary, financialLine, monthlyFinancial, monthlyIncidents } from "@/modules/reports/monthly-executive";
import { generateMonthlyPdf } from "@/modules/reports/monthly-pdf";
import { roiFixture, roiInput } from "./fixtures/monthly-roi";

/** O relatório como `computeMonthlyReport` o devolve, com as premissas dadas. */
function report(assumptions: Partial<MonthlyReport["assumptions"]>): MonthlyReport {
  const r = roiFixture();
  r.assumptions = { ...r.assumptions, ...assumptions };
  r.current = applyMonthlyOverrides(r.automatic!.current, {}, r.assumptions);
  r.quality = monthlyQuality(r);
  r.limitations = monthlyLimitations(r);
  return r;
}
/** Como o Instituto do Sorriso em setembro: sem ticket nem conversão, só o custo do atendente. */
const semFinanceiro = () => report({ procedures: [], investmentCents: 15_000 });
/** Todo texto do relatório que o decisor lê, fora o bloco opcional de retorno. */
const everything = (r: MonthlyReport) => {
  const e = executiveSummary(r);
  const tables = Object.values(e.tables).flatMap((t) => t ? [t.title, ...t.head, t.note ?? "", ...t.rows.flatMap((row) => row.cells)] : []);
  return [e.lede, ...e.kpis.flatMap((k) => [k.label, k.value, k.hint, k.delta ?? ""]), ...e.attendance, ...e.agenda, e.adjustments, e.questions ?? "", e.leads,
    e.unplanned.note, ...e.unplanned.incidents, ...e.unplanned.limitations, ...tables].join("\n");
};

describe("resumo executivo: o que o Fechai controla", () => {
  it("aceite: sem premissas financeiras, o relatório não mostra ROI, receita, economia nem pendente", () => {
    const r = semFinanceiro();
    expect(executiveSummary(r).financial).toBeNull(); expect(monthlyFinancial(r)).toBeNull();
    expect(everything(r)).not.toMatch(/ROI|receita|economia|pendente|não verificado|R\$/i);
    // Nem pendência, nem limitação, nem selo "não verificado" por causa do dinheiro.
    expect(r.current.missing).toEqual([]); expect(r.limitations).toEqual([]); expect(unverifiedMetrics(r)).toEqual([]);
    expect(r.quality?.roi).toBeUndefined(); expect(r.quality?.revenue).toBeUndefined();
  });
  it("quatro números na ordem do modelo, com a agenda marcada como o número principal", () => {
    const kpis = executiveSummary(semFinanceiro()).kpis;
    expect(kpis.map((k) => k.label)).toEqual(["Contatos atendidos", "Avaliações agendadas", "Compareceram", "1ª resposta do agente"]);
    expect(kpis.map((k) => Boolean(k.anchor))).toEqual([false, true, false, false]);
    // Todos os contatos no número; o expediente é o detalhe embaixo.
    expect(kpis[0]).toMatchObject({ value: "1", hint: "0 no expediente · 1 fora" });
    expect(kpis[1]).toMatchObject({ value: "1", hint: "0 no expediente · 1 fora" });
    expect(kpis[3]).toMatchObject({ value: "10 s", hint: "mediana · 24h por dia" });
  });
  it("sem expediente conferido não aparece pendente: sai o total, sem a divisão", () => {
    const r = report({ procedures: [], humanHours: null });
    expect(everything(r)).not.toMatch(/pendente|não verificado/i);
    const exec = executiveSummary(r);
    expect(exec.kpis[1]).toMatchObject({ value: "1", hint: "pelo agente no mês" });
    expect(exec.kpis[0].hint).toBe("conversas respondidas pelo agente");
    // Sem expediente cadastrado não há como dizer quando o contato chegou.
    expect(exec.tables.arrivals).toBeNull(); expect(exec.tables.funnel.head).toEqual(["Etapa", "Total"]);
  });
  it("retorno estimado ligado e calculado: o bloco existe; ligado e incompleto, some", () => {
    const full = report({ financialEnabled: true });
    expect(monthlyFinancial(full)).toMatchObject({ revenueCents: 50_000, roiPercent: full.current.roiPercent });
    expect(financialLine(monthlyFinancial(full)!)).toContain("ROI");
    const incomplete = report({ financialEnabled: true, attendantMonthlyCents: null });
    expect(monthlyFinancial(incomplete)).toBeNull();
    // Ligado, a falta volta a ser dita: é limitação, não silêncio.
    expect(incomplete.limitations?.map((l) => l.key)).toEqual(["team"]);
    expect([executiveSummary(incomplete).lede, ...executiveSummary(incomplete).attendance].join(" ")).not.toMatch(/ROI|R\$/);
  });
  it("relatório já fechado com premissas completas continua mostrando o retorno (chave ausente)", () => {
    const old = roiFixture();
    expect(old.assumptions.financialEnabled).toBeUndefined();
    expect(monthlyFinancial(old)).not.toBeNull();
  });
  it("primeira resposta: a mediana não é puxada por um atraso isolado", () => {
    const input = roiInput();
    const at = (iso: string) => new Date(iso);
    input.conversations = [10, 20, 600].map((seconds, i) => ({ id: `c${i}`, leadId: `c${i}`, variables: {}, lead: { createdAt: at("2026-09-14T10:00:00Z") }, firstInbound: at("2026-09-14T10:00:00Z"),
      messages: [{ id: `c${i}-in`, role: "user", sentBy: null, createdAt: at("2026-09-14T10:00:00Z") },
        { id: `c${i}-out`, role: "assistant", sentBy: "agent", createdAt: new Date(at("2026-09-14T10:00:00Z").getTime() + seconds * 1000) }] }));
    const { metrics } = evaluateMonthlyMetrics(input);
    expect(metrics.firstResponseSeconds).toBeCloseTo(210); expect(metrics.firstResponseMedianSeconds).toBe(20);
    expect(metrics.agentFirstResponseMedianSeconds).toBe(20);
  });
  it("todos os contatos contam: a receita conservadora só existe no bloco de retorno", () => {
    const r = report({ financialEnabled: true });
    const exec = executiveSummary(r);
    // O procedimento mostra todas as agendadas e os comparecimentos; "fora" é só da receita.
    expect(exec.tables.procedures?.head).toEqual(["Procedimento", "Qualificados", "Agendadas", "Compareceram"]);
    expect(exec.tables.procedures?.rows[0].cells).toEqual(["Implante", "1", "1", "1"]);
    expect(exec.lede).toContain("1 contato chegou com a recepção fechada e foi atendido do mesmo jeito");
  });
});

describe("o que não saiu como planejado: aparece sempre, só com o que os dados comprovam", () => {
  it("sem incidente, sem limitação e sem texto, a seção diz que não houve incidente relevante", () => {
    const r = semFinanceiro();
    expect(monthlyIncidents(r)).toEqual([]);
    expect(executiveSummary(r).unplanned).toEqual({ note: "", incidents: [], limitations: [], none: true });
    expect(NO_INCIDENT).toBe("Nenhum incidente relevante identificado neste mês.");
  });
  it("o texto da revisão e as limitações entram inteiros, sem corte", () => {
    const r = semFinanceiro();
    r.limitationsNote = "Três avaliações ficaram sem confirmação de comparecimento até o fechamento.";
    r.limitations = Array.from({ length: 5 }, (_, i) => ({ key: `k${i}`, text: `Limitação ${i}.`, affects: [] }));
    const unplanned = executiveSummary(r).unplanned;
    expect(unplanned.none).toBe(false); expect(unplanned.note).toContain("Três avaliações"); expect(unplanned.limitations).toHaveLength(5);
  });
  it("faltas, queda do agente e espera da recepção viram incidentes, com o número de cada um", () => {
    const r = semFinanceiro();
    r.current = { ...r.current, attended: { inside: 13, outside: 8, unclassified: 0 },
      agenda: { noShow: { inside: 4, outside: 2, unclassified: 0 }, unconfirmed: { inside: 0, outside: 1, unclassified: 0 }, upcoming: { inside: 2, outside: 1, unclassified: 0 } },
      reception: { agentOnly: 0, transferred: 1, teamJoined: 0, answered: 0, medianSeconds: null, overHour: 1, unanswered: 1 },
      availability: { measuredFrom: "2026-09-01T03:00:00.000Z", partial: false, coveredSeconds: 2_592_000, downSeconds: 10_800, percent: 99.5, contactsAffected: 6,
        incidents: [{ startedAt: "2026-09-17T22:00:00.000Z", endedAt: "2026-09-18T01:00:00.000Z", seconds: 10_800, contacts: 6 }] } };
    const incidents = monthlyIncidents(r);
    expect(incidents[0]).toBe("6 faltas: 22% das consultas com presença ou falta registrada.");
    expect(incidents[1]).toBe("O agente ficou 3h fora do ar em 17/09, das 19:00 às 22:00. 6 contatos escreveram nesse período e esperaram a conexão voltar.");
    expect(incidents[2]).toBe("1 conversa passada para a recepção esperou mais de 1 hora, e 1 seguia sem resposta no fim do mês.");
    const exec = executiveSummary(r);
    expect(exec.unplanned.none).toBe(false);
    expect(exec.kpis[2]).toMatchObject({ value: "21", hint: "78% das consultas com presença ou falta registrada", delta: "3 ainda vão acontecer" });
    // Sem confirmação não é falta: fica na própria linha, fora da taxa.
    expect(exec.tables.outcome?.rows.map((row) => row.cells)).toEqual([
      ["Compareceram", "13", "8", "21"], ["Faltaram", "4", "2", "6"], ["Sem confirmação de comparecimento", "0", "1", "1"], ["Total de consultas já realizadas", "17", "11", "28"]]);
  });
});

describe("PDF sem retorno estimado", () => {
  it("fechado sem premissas financeiras gera o PDF, que flui em mais de uma página", async () => {
    const r = semFinanceiro(); r.status = "ready"; r.limitationsNote = "Três avaliações ficaram sem confirmação.";
    expect((await PDFDocument.load(await generateMonthlyPdf(r))).getPageCount()).toBeGreaterThanOrEqual(2);
  });
});
