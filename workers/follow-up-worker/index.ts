import { Queue, Worker, type ConnectionOptions } from "bullmq";
import { scanAndSendFollowUps } from "./scan";
import { scanAndSendReminders } from "./reminders";
import { scanAndSendClinicorpReminders } from "./clinicorp-reminders";
import { scanWhatsappHealth } from "../../src/modules/whatsapp/health";
import { scanBroadcasts } from "../../src/modules/broadcasts/worker";
import { touchBroadcastWorker } from "../../src/modules/broadcasts/health";

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
const CLINICORP_REMINDER_QUEUE = "clinicorp-reminders";
const FOLLOWUP_EVERY_MS =
  Number(process.env.FOLLOWUP_SCAN_EVERY_MINUTES ?? 15) * 60_000;
const REMINDER_EVERY_MS =
  Number(process.env.REMINDER_SCAN_EVERY_MINUTES ?? 1) * 60_000;
const HEALTH_EVERY_MS =
  Number(process.env.WHATSAPP_HEALTH_SCAN_EVERY_MINUTES ?? 1) * 60_000;
// Cada volta relê a agenda do Clinicorp de cada conta: a cada minuto, como os
// lembretes do fechai, seriam 1.440 chamadas por dia por clínica. Cinco minutos
// de atraso num lembrete de consulta não mudam nada para o paciente.
const CLINICORP_REMINDER_EVERY_MS =
  Number(process.env.CLINICORP_REMINDER_SCAN_EVERY_MINUTES ?? 5) * 60_000;

async function main() {
  const followUpQueue = new Queue(FOLLOWUP_QUEUE, { connection });
  const reminderQueue = new Queue(REMINDER_QUEUE, { connection });
  const healthQueue = new Queue(HEALTH_QUEUE, { connection });
  const clinicorpReminderQueue = new Queue(CLINICORP_REMINDER_QUEUE, { connection });
  const broadcastQueue = new Queue("whatsapp-broadcasts", { connection });
  await broadcastQueue.setGlobalConcurrency(1);
  await broadcastQueue.upsertJobScheduler(
    "broadcast-scheduler",
    { every: 10_000 },
    { name: "broadcasts" },
  );
  const broadcastWorker = new Worker(
    "whatsapp-broadcasts",
    async () => {
      try {
        const result = await scanBroadcasts();
        await touchBroadcastWorker(true);
        return result;
      } catch (error) {
        await touchBroadcastWorker(
          true,
          "O serviço encontrou uma falha ao processar a fila.",
        ).catch(() => {});
        throw error;
      }
    },
    { connection, concurrency: 1 },
  );
  // O sinal não depende da duração da varredura. Redis indisponível não anuncia saúde.
  let checkingHeartbeat = false;
  const heartbeat = async () => {
    if (checkingHeartbeat) return;
    checkingHeartbeat = true;
    try {
      if (
        (await broadcastWorker.client).status !== "ready" ||
        !broadcastWorker.isRunning()
      )
        return;
      await broadcastQueue.getJobCounts("wait", "active");
      await touchBroadcastWorker();
    } catch {
      /* expira na tela */
    } finally {
      checkingHeartbeat = false;
    }
  };
  await heartbeat();
  setInterval(heartbeat, 15_000).unref();
  broadcastWorker.on("failed", (job, err) =>
    console.error(`[disparos] job ${job?.id} falhou`, err),
  );

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
  await clinicorpReminderQueue.upsertJobScheduler(
    "scan-scheduler",
    { every: CLINICORP_REMINDER_EVERY_MS },
    { name: "scan-clinicorp-reminders" },
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
  const clinicorpReminderWorker = new Worker(
    CLINICORP_REMINDER_QUEUE,
    async () => {
      const r = await scanAndSendClinicorpReminders();
      console.log(
        `[lembrete clinicorp] contas=${r.tenants} consultas=${r.scanned} sent=${r.sent} primeiro_contato_pulado=${r.firstContactSkipped}`,
      );
      return r;
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
  clinicorpReminderWorker.on("failed", (job, err) =>
    console.error(`[lembrete clinicorp] job ${job?.id} falhou`, err),
  );
  console.log(
    `[worker] online — follow-up a cada ${FOLLOWUP_EVERY_MS / 60000} min; ` +
      `lembretes a cada ${REMINDER_EVERY_MS / 60000} min; ` +
      `lembretes do Clinicorp a cada ${CLINICORP_REMINDER_EVERY_MS / 60000} min; ` +
      `saúde do WhatsApp a cada ${HEALTH_EVERY_MS / 60000} min`,
  );
}

main().catch((err) => {
  console.error("[follow-up] fatal", err);
  process.exit(1);
});
