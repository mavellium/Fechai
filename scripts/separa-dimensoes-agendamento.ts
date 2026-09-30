/**
 * Separa o legado `Appointment.status = "done"` nas dimensões novas
 * (ver src/modules/scheduling/dimensions.ts).
 *
 * "done" era o botão "Concluir" da /agenda, que o relatório mensal já lia como
 * presença confirmada por alguém da clínica. Vira:
 *
 *   status: "scheduled"  (de pé — o ciclo de vida só tem de pé ou cancelada)
 *   attendance: "attended", attendanceSource: "human"
 *   attendanceAt: null   (de propósito: não sabemos QUANDO foi marcado)
 *
 * `attendanceAt` nulo é o que mantém a regra antiga do relatório para
 * consultas espelhadas no Clinicorp: a marcação legada não substitui o status
 * de lá; só a marcação feita depois desta mudança (com data) substitui.
 *
 * Até rodar, `attendanceOf()` já lê "done" como "compareceu", então o script
 * não é urgente — só limpa o legado.
 *
 * Rode depois do `db push`:
 *   npx tsx scripts/separa-dimensoes-agendamento.ts           (só mostra)
 *   npx tsx scripts/separa-dimensoes-agendamento.ts --aplicar
 *
 * Idempotente: rodar de novo não muda nada.
 */
import { prisma } from "../src/lib/prisma";

async function main() {
  const apply = process.argv.includes("--aplicar");
  const now = new Date();
  const [past, future] = await Promise.all([
    prisma.appointment.count({ where: { status: "done", startsAt: { lte: now } } }),
    prisma.appointment.count({ where: { status: "done", startsAt: { gt: now } } }),
  ]);
  console.log(`${past} agendamento(s) "done" com horário já passado — serão convertidos.`);
  // "Concluído" antes da hora: convertido agora, viraria consulta de pé,
  // receberia lembrete e bloquearia o horário. Fica legado (lido como
  // compareceu) e é convertido numa próxima rodada, depois do horário.
  if (future) console.log(`${future} "done" com horário FUTURO ficam como estão até o horário passar.`);
  if (!apply) {
    console.log("Nada foi gravado. Rode com --aplicar para converter.");
    return;
  }
  const { count } = await prisma.appointment.updateMany({
    where: { status: "done", startsAt: { lte: now } },
    data: { status: "scheduled", attendance: "attended", attendanceSource: "human", attendanceAt: null },
  });
  console.log(`${count} convertido(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
