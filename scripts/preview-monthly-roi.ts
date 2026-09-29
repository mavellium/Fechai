import { mkdir, writeFile } from "node:fs/promises";
import { roiFixture } from "../tests/fixtures/monthly-roi";
import { generateMonthlyPdf } from "../src/modules/reports/monthly-pdf";
import { applyMonthlyOverrides } from "../src/modules/reports/monthly-overrides";
import type { MonthlyTimeMetrics } from "../src/modules/reports/monthly-time";

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
  report.assumptions.procedures = Array.from({ length: 12 }, (_, i) => ({ name: `Procedimento de avaliação com nome extenso e referência ${i}`, ticketCents: 100_000, conversionBps: 5000 }));
  report.adjustments = "Revisamos a abordagem do agente e conferimos as informações. ".repeat(7).slice(0, 400);
  report.nextMonth = report.adjustments;
  await writeFile("tmp/roi/roi-maximo.pdf", await generateMonthlyPdf(report));
  console.log("Amostras fictícias para conferir a exportação, sem dados de pacientes.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
