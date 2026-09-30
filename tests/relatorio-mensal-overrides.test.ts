import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { applyMonthlyOverrides, monthlyOverridesSchema, parseMonthlyOverrides } from "@/modules/reports/monthly-overrides";
import { generateMonthlyPdf } from "@/modules/reports/monthly-pdf";
import { roiConfig, roiFixture } from "./fixtures/monthly-roi";

describe("correções manuais dos indicadores", () => {
  it("mantém a base automática e recalcula economia e ROI com as horas conferidas", () => {
    const base = roiFixture().current;
    const next = applyMonthlyOverrides(base, { newContacts: 45, firstResponseSeconds: 8.5, handoffs: 3, assumedHours: 7.5 }, roiConfig());
    expect(next.newContacts).toBe(45); expect(next.firstResponseSeconds).toBe(8.5); expect(next.handoffs).toBe(3);
    expect(next.assumedHours).toBe(7.5); expect(next.savingsCents).toBe(7500); expect(next.revenueCents).toBe(50000);
    expect(next.roiPercent).toBe(475); expect(base.assumedHours).toBe(0.1);
  });
  it("atualiza só a parte corrigida e não atribui receita a avaliações dentro do expediente", () => {
    const next = applyMonthlyOverrides(roiFixture().current, { attended: { inside: 20 }, aiOnlyConversations: 10 }, roiConfig());
    expect(next.attended).toEqual({ inside: 20, outside: 1, unclassified: 0 });
    expect(next.revenueCents).toBe(50000); expect(next.assumedHours).toBe(1);
  });
  it("corrige presenças por procedimento com a mesma regra de ticket e conversão", () => {
    const next = applyMonthlyOverrides(roiFixture().current, { attended: { outside: 3 },
      procedures: [{ name: "Implante", qualified: 9, attendedOutside: 3 }] }, roiConfig());
    expect(next.revenueCents).toBe(150000); expect(next.procedures[0].qualified).toBe(9);
    expect(next.roiPercent).toBe(1401);
  });
  it("não calcula receita nem libera fechamento quando a soma das presenças diverge", () => {
    const next = applyMonthlyOverrides(roiFixture().current, { attended: { outside: 3 } }, roiConfig());
    expect(next.revenueCents).toBeNull(); expect(next.roiPercent).toBeNull(); expect(next.missing.join(" ")).toContain("soma por procedimento");
  });
  it("aceita zero, permite marcar tempo não medido e a remoção recupera o cálculo automático", () => {
    const base = roiFixture().current;
    expect(applyMonthlyOverrides(base, { handoffs: 0, firstResponseSeconds: null, assumedHours: null }, roiConfig())).toMatchObject({ handoffs: 0, firstResponseSeconds: null, assumedHours: null, savingsCents: null });
    expect(applyMonthlyOverrides(base, {}, roiConfig()).roiPercent).toBe(base.roiPercent);
  });
  it("recusa contagens negativas/fracionadas, picos inválidos e tentativa de fixar ROI ou receita", () => {
    for (const current of [{ newContacts: -1 }, { handoffs: 0.5 }, { assumedHours: Infinity }, { roiPercent: 1000 }, { revenueCents: 99999 },
      { peaks: [{ hour: 24, messages: 1 }] }, { peaks: [{ hour: 9, messages: 1 }, { hour: 9, messages: 2 }] }]) {
      expect(monthlyOverridesSchema.safeParse({ current, previous: {} }).success).toBe(false);
    }
  });
  it("lê registros antigos e salva correções de cada mês separadamente", () => {
    expect(parseMonthlyOverrides(roiConfig())).toEqual({ current: {}, previous: {} });
    expect(parseMonthlyOverrides({ metricOverrides: { current: { newContacts: 12 }, previous: { newContacts: 6 } } })).toEqual({ current: { newContacts: 12 }, previous: { newContacts: 6 } });
  });
  it("exporta A4 incorporando imagens das duas marcas e horas manuais", async () => {
    const report = roiFixture(); report.metricOverrides = { current: { assumedHours: 7.5 }, previous: {} };
    report.current = applyMonthlyOverrides(report.current, report.metricOverrides.current, report.assumptions);
    const doc = await PDFDocument.load(await generateMonthlyPdf(report));
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(2);
    // Cada marca é um XObject independente. A página 1 leva a faixa com o nome em texto; as marcas vão no cabeçalho do detalhe.
    const resources = doc.getPage(1).node.Resources();
    expect(resources?.toString().match(/\/Image-/g)?.length).toBe(2);
  });
});
