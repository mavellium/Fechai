import { prisma } from "@/lib/prisma";
const KEY = "whatsapp-broadcasts";
export async function touchBroadcastWorker(
  completed = false,
  error: string | null = null,
) {
  const now = new Date();
  await prisma.workerHeartbeat.upsert({
    where: { key: KEY },
    create: {
      key: KEY,
      lastSeenAt: now,
      ...(completed ? { lastCompletedAt: now } : {}),
      error,
    },
    update: {
      lastSeenAt: now,
      ...(completed ? { lastCompletedAt: now, error } : {}),
    },
  });
}
export async function getBroadcastWorkerHealth() {
  const value = await prisma.workerHeartbeat.findUnique({
    where: { key: KEY },
  });
  return {
    online: Boolean(value && Date.now() - value.lastSeenAt.getTime() < 60_000),
    lastSeenAt: value?.lastSeenAt.toISOString() ?? null,
    lastCompletedAt: value?.lastCompletedAt?.toISOString() ?? null,
    error: value?.error ?? null,
  };
}
export type BroadcastWorkerHealth = Awaited<
  ReturnType<typeof getBroadcastWorkerHealth>
>;
