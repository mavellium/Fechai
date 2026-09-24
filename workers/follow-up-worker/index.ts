import { Queue, Worker, type ConnectionOptions } from "bullmq";
import { scanAndSendFollowUps } from "./scan";
import { scanAndSendReminders } from "./reminders";
import { scanWhatsappHealth } from "../../src/modules/whatsapp/health";

// Worker de mensagens no tempo. Follow-up/lembretes rodam na cadência comercial
// configurada; a saúde do WhatsApp tem um job próprio, mais rápido:
//
// - follow-up: conversas em que o lead ficou em silêncio (ver scan.ts);
// - lembrete: consultas que estão chegando (ver reminders.ts);
// - saúde do WhatsApp: número que caiu sem ninguém perceber (ver
//   modules/whatsapp/health.ts).
//
// Continuam no mesmo processo para não criar outro deploy, mas não na mesma
// cadência: depois de um auto-restart, esperar 15 minutos para restaurar o
// webhook ainda perderia mensagens demais. Saúde roda a cada minuto por padrão.
const connection: ConnectionOptions = {
  url: process.env.REDIS_URL ?? "redis://localhost:6379",
};

const FOLLOWUP_QUEUE = "follow-up";
const REMINDER_QUEUE = "appointment-reminders";
const HEALTH_QUEUE = "whatsapp-health";
const FOLLOWUP_EVERY_MS = Number(process.env.FOLLOWUP_SCAN_EVERY_MINUTES ?? 15) * 60_000;
const REMINDER_EVERY_MS = Number(process.env.REMINDER_SCAN_EVERY_MINUTES ?? 1) * 60_000;
const HEALTH_EVERY_MS = Number(process.env.WHATSAPP_HEALTH_SCAN_EVERY_MINUTES ?? 1) * 60_000;

async function main() {
  const followUpQueue = new Queue(FOLLOWUP_QUEUE, { connection });
  const reminderQueue = new Queue(REMINDER_QUEUE, { connection });
  const healthQueue = new Queue(HEALTH_QUEUE, { connection });

  // Filas separadas: uma varredura de follow-up demorada não pode atrasar o
  // watchdog que precisa reparar o webhook em até um minuto.
  await followUpQueue.upsertJobScheduler(
    "scan-scheduler",
    { every: FOLLOWUP_EVERY_MS },
    { name: "scan" },
  );
  await reminderQueue.upsertJobScheduler(
    "scan-scheduler",
    { every: REMINDER_EVERY_MS },
    { name: "scan-reminders" },
  );
  await healthQueue.upsertJobScheduler(
    "whatsapp-health-scheduler",
    { every: HEALTH_EVERY_MS },
    { name: "whatsapp-health" },
  );

  const followUpWorker = new Worker(
    FOLLOWUP_QUEUE,
    async () => {
      const result = await scanAndSendFollowUps();
      console.log(`[follow-up] scanned=${result.scanned} sent=${result.sent}`);
      return result;
    },
    { connection },
  );
  const reminderWorker = new Worker(
    REMINDER_QUEUE,
    async () => {
      const result = await scanAndSendReminders();
      console.log(`[lembrete] scanned=${result.scanned} sent=${result.sent}`);
      return result;
    },
    { connection },
  );
  const healthWorker = new Worker(
    HEALTH_QUEUE,
    async () => {
      const health = await scanWhatsappHealth();
      console.log(
        `[whatsapp health] scanned=${health.scanned} broken=${health.broken} alerted=${health.alerted}`,
      );
      return { health };
    },
    { connection },
  );

  followUpWorker.on("failed", (job, err) =>
    console.error(`[follow-up] job ${job?.id} falhou`, err),
  );
  reminderWorker.on("failed", (job, err) =>
    console.error(`[lembrete] job ${job?.id} falhou`, err),
  );
  healthWorker.on("failed", (job, err) =>
    console.error(`[whatsapp health] job ${job?.id} falhou`, err),
  );
  console.log(
    `[worker] online — follow-up a cada ${FOLLOWUP_EVERY_MS / 60000} min; ` +
      `lembretes a cada ${REMINDER_EVERY_MS / 60000} min; ` +
      `saúde do WhatsApp a cada ${HEALTH_EVERY_MS / 60000} min`,
  );
}

main().catch((err) => {
  console.error("[follow-up] fatal", err);
  process.exit(1);
});
