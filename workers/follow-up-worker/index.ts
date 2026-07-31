import { Queue, Worker, type ConnectionOptions } from "bullmq";
import { scanAndSendFollowUps } from "./scan";

// Worker de follow-up. Um job repetível "scan" roda a cada N minutos e dispara
// follow-ups para conversas sem resposta (ver scan.ts).
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
      const result = await scanAndSendFollowUps();
      console.log(`[follow-up] scanned=${result.scanned} sent=${result.sent}`);
      return result;
    },
    { connection },
  );

  worker.on("failed", (job, err) => console.error(`[follow-up] job ${job?.id} falhou`, err));
  console.log(`[follow-up] worker online — varredura a cada ${EVERY_MS / 60000} min`);
}

main().catch((err) => {
  console.error("[follow-up] fatal", err);
  process.exit(1);
});
