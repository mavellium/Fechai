import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { verifyReminderLedger } from "./lib/reminder-ledger-smoke";
async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/invalid");
  assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.port, "5438"); assert.equal(url.pathname, "/fechai_reminders_test");
  const tenant = await prisma.tenant.create({ data: { name: "Synthetic reminder SQL test" } });
  try { await verifyReminderLedger(tenant.id); }
  finally { await prisma.tenant.delete({ where: { id: tenant.id } }); await prisma.$disconnect(); }
}
main().catch(() => { console.error("REMINDER_LEDGER_FAILED"); process.exitCode = 1; });
