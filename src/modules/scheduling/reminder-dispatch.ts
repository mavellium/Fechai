import { randomUUID } from "node:crypto";
import { prisma } from "../../lib/prisma";

export type ReminderKey = { tenantId: string; sourceKey: string; startsAt: Date; minutesBefore: number };
export const reminderSource = (id: string, clinicorpId?: string | null) => clinicorpId ? `clinicorp:${clinicorpId}` : `appointment:${id}`;
const whereKey = (key: ReminderKey) => ({ tenantId_sourceKey_startsAt_minutesBefore: key });
const terminal = ["sent", "manual", "unknown", "skipped"];
export async function ensureReminder(key: ReminderKey) {
  return prisma.reminderDispatch.upsert({ where: whereKey(key), create: key, update: {} });
}
export async function blockReminder(key: ReminderKey, reason: string) {
  const row = await ensureReminder(key);
  await prisma.reminderDispatch.updateMany({ where: { id: row.id, tenantId: key.tenantId, state: { in: ["queued", "blocked"] } }, data: { state: "blocked", reason } });
}
export async function claimReminder(key: ReminderKey) {
  const row = await ensureReminder(key);
  // Abandoned POST may have reached WhatsApp. Expiry never authorizes another POST.
  if (row.state === "sending" && row.claimedAt && row.claimedAt.getTime() < Date.now() - 300_000) {
    await prisma.reminderDispatch.updateMany({ where: { id: row.id, tenantId: key.tenantId, state: "sending", token: row.token },
      data: { state: "unknown", reason: "O envio ficou sem confirmação. Confira o WhatsApp antes de enviar novamente." } });
    return null;
  }
  if (terminal.includes(row.state)) return null;
  const token: string = randomUUID();
  const claimed = await prisma.reminderDispatch.updateMany({ where: { id: row.id, tenantId: key.tenantId, state: { in: ["queued", "blocked"] } },
    data: { state: "sending", token, claimedAt: new Date(), reason: null } });
  return claimed.count ? { id: row.id, token, tenantId: key.tenantId } : null;
}
export type ReminderClaim = NonNullable<Awaited<ReturnType<typeof claimReminder>>>;
export async function finishReminder(claim: ReminderClaim, state: "sent" | "unknown" | "blocked" | "skipped", data: {
  provider?: string; messageId?: string | null; conversationId?: string; reason?: string; acceptedAt?: Date;
} = {}) {
  await prisma.reminderDispatch.updateMany({ where: { id: claim.id, tenantId: claim.tenantId, token: claim.token, state: { in: ["sending", "unknown"] } },
    data: { state, ...data, token: null } });
  if (data.provider && data.messageId) await reconcileReminderReceipt(claim.tenantId, data.provider, data.messageId);
}
export async function markReminderManual(key: ReminderKey, userId: string) {
  const row = await ensureReminder(key);
  if (row.state === "sent" || row.state === "manual") return true;
  const changed = await prisma.reminderDispatch.updateMany({ where: { id: row.id, tenantId: key.tenantId, state: { in: ["queued", "blocked", "unknown", "skipped"] } },
    data: { state: "manual", manualBy: userId, acceptedAt: new Date(), reason: "Confirmação registrada pela equipe." } });
  return Boolean(changed.count);
}
export async function reminderAlreadyHandled(key: ReminderKey) {
  const row = await prisma.reminderDispatch.findUnique({ where: whereKey(key) });
  return row && terminal.includes(row.state) ? row : null;
}
const deliveryRank: Record<string, number> = { sent: 1, failed: 2, delivered: 3, read: 4 };
export async function reconcileReminderReceipt(tenantId: string, provider: string, messageId: string) {
  const receipts = await prisma.reminderReceipt.findMany({ where: { tenantId, provider, messageId }, select: { status: true, occurredAt: true } });
  const receipt = receipts.sort((a, b) => deliveryRank[b.status] - deliveryRank[a.status])[0];
  if (!receipt) return;
  const lower = Object.keys(deliveryRank).filter((status) => deliveryRank[status] <= deliveryRank[receipt.status]);
  await prisma.reminderDispatch.updateMany({ where: { tenantId, provider, messageId,
    OR: [{ deliveryStatus: null }, { deliveryStatus: { in: lower } }] }, data: { deliveryStatus: receipt.status, deliveryAt: receipt.occurredAt } });
}
export async function recordReminderReceipt(tenantId: string, provider: string, messageId: string, status: string, occurredAt: Date) {
  if (!Object.hasOwn(deliveryRank, status)) return;
  try {
    await prisma.reminderReceipt.upsert({ where: { tenantId_provider_messageId_status: { tenantId, provider, messageId, status } },
      create: { tenantId, provider, messageId, status, occurredAt }, update: {} });
    await reconcileReminderReceipt(tenantId, provider, messageId);
  } catch { console.error("[reminder] Não foi possível registrar um recibo."); }
}
