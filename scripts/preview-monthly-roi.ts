import { mkdir, writeFile } from "node:fs/promises";
import { roiFixture } from "../tests/fixtures/monthly-roi";
import { generateMonthlyPdf } from "../src/modules/reports/monthly-pdf";
import { applyMonthlyOverrides } from "../src/modules/reports/monthly-overrides";
import type { MonthlyTimeMetrics } from "../src/modules/reports/monthly-time";
import { summarizeLeadQuality, type LeadRow } from "../src/modules/lead-insights/summary";
import { normalizeCity } from "../src/modules/lead-insights/city";
import { parseServiceArea } from "../src/modules/lead-insights/service-area";

// Mês fictício de um cliente de tráfego pago: muito lead de fora do raio.
function demoLeadQuality() {
  const row = (city: string | null, doubt: string | null, scheduled: boolean, loss: string | null = null): LeadRow => ({
    createdAt: new Date("2026-09-10T12:00:00Z"), status: "new", disqualified: false, disqualifiedReason: null,
    conversation: { needsHuman: false, lastInboundAt: new Date("2026-09-10T13:00:00Z"), followUpReason: null, handoffEvents: 0 },
    appointments: scheduled ? [{ status: "scheduled" }] : [],
    insight: city || doubt || loss ? { city, cityKey: city ? normalizeCity(city) : null, firstQuestionKey: doubt, lossReasonKey: loss } : null,
  });
  const rows = [
    ...Array.from({ length: 48 }, (_, i) => row("Marília", i < 30 ? "localizacao" : "preco", i < 1, i >= 40 ? "fora_da_regiao" : null)),
    ...Array.from({ length: 14 }, () => row("Bauru", "localizacao", false)),
    ...Array.from({ length: 60 }, (_, i) => row("Garça", i % 3 === 0 ? "preco" : "horario", i < 30, i >= 55 ? "preco" : null)),
    ...Array.from({ length: 78 }, () => row(null, null, false)),
  ];
  return summarizeLeadQuality(rows, parseServiceArea({ baseCity: "Garça", cities: [] }), new Date("2026-10-05T12:00:00Z"));
}

// Tempo devolvido de um mês típico, fictício, para conferir o bloco no PDF.
const stats = (count: number, averageMinutes: number, medianMinutes: number, averageMessages: number) => ({ count, averageMinutes, medianMinutes, averageMessages });
const demoTime: MonthlyTimeMetrics = { textMessages: 1480, audios: 212, audioMinutes: 192, unmeasuredAudios: 0, longAudios: 31, longestAudioSeconds: 288,
  sessions: { all: stats(214, 38, 12, 14), scheduled: stats(52, 46, 21, 18), handoff: stats(19, 64, 30, 22), lost: stats(23, 15, 8, 7), other: stats(120, 31, 10, 12) },
  toSchedule: stats(52, 130, 45, 14) };

async function main() {
  await mkdir("tmp/roi", { recursive: true });
  const report = roiFixture();
  report.assumptions.secondsPerMessage = 30;
  report.featuredCase = "Uma paciente de 74 anos enviou 2 áudios de quase 5 minutos; o agente ouviu tudo, respondeu com paciência e deixou o retorno combinado.";
  report.current = applyMonthlyOverrides({ ...report.current, time: demoTime }, {}, report.assumptions);
  await writeFile("tmp/roi/roi-demo.pdf", await generateMonthlyPdf(report));
  report.leadQuality = demoLeadQuality();
  await writeFile("tmp/roi/roi-com-leads.pdf", await generateMonthlyPdf(report));
  report.assumptions.procedures = Array.from({ length: 12 }, (_, i) => ({ name: `Procedimento de avaliação com nome extenso e referência ${i}`, ticketCents: 100_000, conversionBps: 5000 }));
  report.adjustments = "Revisamos a abordagem do agente e conferimos as informações. ".repeat(7).slice(0, 400);
  report.nextMonth = report.adjustments;
  await writeFile("tmp/roi/roi-maximo.pdf", await generateMonthlyPdf(report));
  console.log("Amostras fictícias para conferir a exportação, sem dados de pacientes.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
