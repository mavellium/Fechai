import { mkdir, writeFile } from "node:fs/promises";
import { roiFixture } from "../tests/fixtures/monthly-roi";
import { generateMonthlyPdf } from "../src/modules/reports/monthly-pdf";
async function main() {
  await mkdir("tmp/roi", { recursive: true });
  const report = roiFixture();
  await writeFile("tmp/roi/roi-demo.pdf", await generateMonthlyPdf(report));
  report.assumptions.procedures = Array.from({ length: 12 }, (_, i) => ({ name: `Procedimento de avaliação com nome extenso e referência ${i}`, ticketCents: 100_000, conversionBps: 5000 }));
  report.adjustments = "Revisamos a abordagem do agente e conferimos as informações. ".repeat(7).slice(0, 400);
  report.nextMonth = report.adjustments;
  await writeFile("tmp/roi/roi-maximo.pdf", await generateMonthlyPdf(report));
  console.log("Amostras fictícias para conferir a exportação, sem dados de pacientes.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
