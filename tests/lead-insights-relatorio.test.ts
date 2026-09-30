import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/modules/scheduling/clinicorp", () => ({ readClinicorpReport: vi.fn() }));
import { PDFDocument } from "pdf-lib";
import { generateMonthlyPdf } from "@/modules/reports/monthly-pdf";
import { leadQualityHeadline, summarizeLeadQuality, type LeadQuality, type LeadRow } from "@/modules/lead-insights/summary";
import { normalizeCity } from "@/modules/lead-insights/city";
import { parseServiceArea } from "@/modules/lead-insights/service-area";
import { roiFixture } from "./fixtures/monthly-roi";

const NOW = new Date("2026-10-05T12:00:00Z");
const area = parseServiceArea({ baseCity: "Garça", cities: [] });

function lead(city: string | null, doubt: string | null, extra: Partial<LeadRow> = {}): LeadRow {
  return {
    createdAt: new Date("2026-09-10T12:00:00Z"), status: "new", disqualified: false, disqualifiedReason: null,
    conversation: { needsHuman: false, lastInboundAt: new Date("2026-09-10T13:00:00Z"), followUpReason: null, handoffEvents: 0 },
    appointments: [],
    insight: city || doubt ? { city, cityKey: city ? normalizeCity(city) : null, firstQuestionKey: doubt, lossReasonKey: null } : null,
    ...extra,
  };
}

/** Mês do Instituto: muitos leads de Marília, pouco agendamento, dúvida sobre localização. */
function instituteQuality(): LeadQuality {
  const rows = [
    ...Array.from({ length: 48 }, (_, i) => lead("Marília", i < 30 ? "localizacao" : "preco", { appointments: i < 1 ? [{ status: "scheduled" }] : [] })),
    ...Array.from({ length: 14 }, () => lead("Bauru", "localizacao")),
    ...Array.from({ length: 60 }, (_, i) => lead("Garça", "horario", { appointments: i < 30 ? [{ status: "scheduled" }] : [] })),
    ...Array.from({ length: 78 }, () => lead(null, null)),
  ];
  return summarizeLeadQuality(rows, area, NOW);
}

describe("relatório mensal — qualidade dos leads", () => {
  it("o exemplo do Instituto vira a frase e as sugestões do relatório", () => {
    const q = instituteQuality();
    expect(q).toMatchObject({ leads: 200, withCity: 122, outOfRadius: 62, outScheduled: 1, inScheduled: 30, inRadius: 60 });
    expect(q.cities.find((c) => c.verdict === "out")).toMatchObject({ city: "Marília", count: 48 });
    expect(leadQualityHeadline(q)).toBe("Dos 200 leads, 122 informaram a cidade: 62 eram de fora do raio (48 de Marília), e 1 deles agendou. Dentro do raio, 30 de 60 agendaram.");
    expect(q.suggestions).toEqual([
      "Restringir a segmentação dos anúncios a Garça e às cidades atendidas, ou excluir Marília.",
      'Colocar "em Garça" no texto do anúncio, para quem é de outra cidade não clicar.',
      "Incluir o endereço da clínica na mensagem de boas-vindas.",
    ]);
  });

  it("sem leads (relatório antigo ou mês sem leads) o PDF não ganha o bloco", async () => {
    const report = roiFixture();
    const without = (await PDFDocument.load(await generateMonthlyPdf(report))).getPageCount();
    report.leadQuality = summarizeLeadQuality([], area, NOW);
    expect((await PDFDocument.load(await generateMonthlyPdf(report))).getPageCount()).toBe(without);
  });

  it("com leads analisados, o bloco entra na análise detalhada, em A4", async () => {
    const report = roiFixture();
    const without = (await PDFDocument.load(await generateMonthlyPdf(report))).getPageCount();
    report.leadQuality = instituteQuality();
    const doc = await PDFDocument.load(await generateMonthlyPdf(report));
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(without);
    expect(doc.getPage(1).getSize().width).toBeCloseTo(595.28);
    expect(doc.getPage(1).getSize().height).toBeCloseTo(841.89);
  });

  it("comporta o conteúdo máximo: listas cheias, cidades e categorias longas", async () => {
    const report = roiFixture();
    const q = instituteQuality();
    q.cities = Array.from({ length: 8 }, (_, i) => ({ city: `Cidade com nome bem comprido número ${i}`, count: 9 - i, scheduled: 0, verdict: "out" as const }));
    q.doubts = Array.from({ length: 6 }, (_, i) => ({ key: `d${i}`, label: `Dúvida com um rótulo bastante extenso ${i}`, count: 9 - i }));
    q.losses = q.doubts.map((d) => ({ ...d, key: `l${d.key}` }));
    q.suggestions = Array.from({ length: 5 }, (_, i) => `Sugestão longa número ${i}: ${"restringir a segmentação dos anúncios ".repeat(3)}`);
    report.leadQuality = q;
    // As páginas de detalhe fluem: listas cheias quebram de página, nunca derrubam a exportação.
    expect((await PDFDocument.load(await generateMonthlyPdf(report))).getPageCount()).toBeGreaterThanOrEqual(2);
  });

  it("sem área configurada o PDF não afirma raio", async () => {
    const report = roiFixture();
    report.leadQuality = summarizeLeadQuality([lead("Marília", "preco"), lead("Garça", "horario")], null, NOW);
    expect(report.leadQuality.areaConfigured).toBe(false);
    expect((await PDFDocument.load(await generateMonthlyPdf(report))).getPageCount()).toBeGreaterThanOrEqual(2);
  });

  it("o bloco entra no snapshot como JSON simples", () => {
    const q = instituteQuality();
    expect(JSON.parse(JSON.stringify(q))).toEqual(q);
  });
});
