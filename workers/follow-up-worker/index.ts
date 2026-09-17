import { Queue, Worker, type ConnectionOptions } from "bullmq";
import { scanAndSendFollowUps } from "./scan";
import { scanAndSendReminders } from "./reminders";
import { scanWhatsappHealth } from "../../src/modules/whatsapp/health";

// Worker de mensagens no tempo. Um job repetível "scan" roda a cada N minutos
// e faz três varreduras independentes:
//
// - follow-up: conversas em que o lead ficou em silêncio (ver scan.ts);
// - lembrete: consultas que estão chegando (ver reminders.ts);
// - saúde do WhatsApp: número que caiu sem ninguém perceber (ver
//   modules/whatsapp/health.ts).
//
// Vivem no mesmo ciclo porque a cadência serve às três e um segundo processo
// custaria outro deploy para ganhar nada. A de saúde entrou aqui por um motivo
// a mais: ela precisa rodar mesmo quando NINGUÉM abre o painel — o modo de
// falha que ela existe para pegar é justamente o silêncio que ninguém vê.
const connection: ConnectionOptions = {
  url: process.env.REDIS_URL ?? "redis://localhost:6379",
};

const QUEUE = "follow-up";
const EVERY_MS = Number(process.env.FOLLOWUP_SCAN_EVERY_MINUTES ?? 15) * 60_000;

async function main() {
  const queue = new Queue(QUEUE, { connection });

  // Agenda a varredura recorrente (idempotente pelo jobId).
  await queue.upsertJobScheduler("scan-scheduler", { every: EVERY_MS }, { name: "scan" });

  const worker = new Worker(
    QUEUE,
    async () => {
      // `allSettled`: uma varredura que falhe não pode calar a outra — são
      // regras independentes, e o lembrete de uma consulta de amanhã não pode
      // depender do follow-up ter dado certo.
      const [followUps, reminders, health] = await Promise.allSettled([
        scanAndSendFollowUps(),
        scanAndSendReminders(),
        scanWhatsappHealth(),
      ]);

      if (followUps.status === "fulfilled") {
        console.log(`[follow-up] scanned=${followUps.value.scanned} sent=${followUps.value.sent}`);
      } else {
        console.error("[follow-up] varredura falhou", followUps.reason);
      }
      if (reminders.status === "fulfilled") {
        console.log(`[lembrete] scanned=${reminders.value.scanned} sent=${reminders.value.sent}`);
      } else {
        console.error("[lembrete] varredura falhou", reminders.reason);
      }
      if (health.status === "fulfilled") {
        console.log(
          `[whatsapp health] scanned=${health.value.scanned} broken=${health.value.broken} alerted=${health.value.alerted}`,
        );
      } else {
        console.error("[whatsapp health] varredura falhou", health.reason);
      }

      // O job só falha se TODAS falharem: uma varredura que funcionou não deve
      // ser reprocessada pelo retry do BullMQ (reenviaria nada, mas poluiria).
      if (
        followUps.status === "rejected" &&
        reminders.status === "rejected" &&
        health.status === "rejected"
      ) {
        throw followUps.reason;
      }
      return {
        followUps: followUps.status === "fulfilled" ? followUps.value : null,
        reminders: reminders.status === "fulfilled" ? reminders.value : null,
        health: health.status === "fulfilled" ? health.value : null,
      };
    },
    { connection },
  );

  worker.on("failed", (job, err) => console.error(`[follow-up] job ${job?.id} falhou`, err));
  console.log(
    `[worker] online — follow-up e lembretes a cada ${EVERY_MS / 60000} min`,
  );
}

main().catch((err) => {
  console.error("[follow-up] fatal", err);
  process.exit(1);
});
