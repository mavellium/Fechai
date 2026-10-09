import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { claimReminder, finishReminder, markReminderManual, recordReminderReceipt, reminderSource } from "@/modules/scheduling/reminder-dispatch";

/** Synthetic keys only; cleanup is limited to this invocation's unpredictable prefix. */
export async function verifyReminderLedger(tenantId: string) {
  const prefix = `sandbox:verification:${randomUUID()}:`;
  const startsAt = new Date(Date.now() + 86_400_000);
  const base = { tenantId, sourceKey: `${prefix}concurrent`, startsAt, minutesBefore: 1440 };
  try {
    const claims = await Promise.all([claimReminder(base), claimReminder(base)]);
    assert.equal(claims.filter(Boolean).length, 1, "SQL claim must have exactly one owner");
    const owner = claims.find((c) => c !== null)!;
    const messageId = `${prefix}message`;
    await recordReminderReceipt(tenantId, "evolution", messageId, "read", new Date());
    await finishReminder(owner, "sent", { provider: "evolution", messageId, acceptedAt: new Date() });
    await recordReminderReceipt(tenantId, "evolution", messageId, "sent", new Date());
    const row = await prisma.reminderDispatch.findUniqueOrThrow({ where: { id: owner.id } });
    assert.equal(row.deliveryStatus, "read", "Early receipt is reconciled and cannot regress");
    assert.equal(await claimReminder(base), null, "Acknowledged sends cannot be repeated");
    const manualKey = { ...base, sourceKey: `${prefix}manual` };
    assert.equal(await markReminderManual(manualKey, "sandbox-verification"), true);
    assert.equal(await claimReminder(manualKey), null, "Manual confirmation consumes the same intent");
    const unknownKey = { ...base, sourceKey: `${prefix}unknown` };
    const uncertain = await claimReminder(unknownKey); assert.ok(uncertain);
    await finishReminder(uncertain, "unknown");
    assert.equal(await claimReminder(unknownKey), null, "Timeout never authorizes an automatic retry");
    const expiredKey = { ...base, sourceKey: `${prefix}expired` };
    const expired = await claimReminder(expiredKey); assert.ok(expired);
    await prisma.reminderDispatch.update({ where: { id: expired.id }, data: { claimedAt: new Date(Date.now() - 360_000) } });
    assert.equal(await claimReminder(expiredKey), null);
    assert.equal((await prisma.reminderDispatch.findUniqueOrThrow({ where: { id: expired.id } })).state, "unknown");
    const moved = await claimReminder({ ...manualKey, startsAt: new Date(startsAt.getTime() + 3_600_000) });
    assert.ok(moved, "Rescheduling has a distinct intent");
    assert.equal(reminderSource("local-a", "remote-1"), reminderSource("local-b", "remote-1"));
    console.log("REMINDER_LEDGER_OK concurrency manual timeout restart reschedule early-receipt monotonic-status");
  } finally {
    await prisma.reminderDispatch.deleteMany({ where: { tenantId, sourceKey: { startsWith: prefix } } });
    await prisma.reminderReceipt.deleteMany({ where: { tenantId, messageId: { startsWith: prefix } } });
  }
}
