/** Explicit operator dispatch: read Clinicorp, exercise synthetic ledger, respond only in sandbox. */
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { prepareConfirmationTest } from "@/modules/scheduling/confirmation-test";
import { listClinicorpAgenda, listClinicorpCategories } from "@/modules/scheduling/clinicorp";
import { dayKeyInZone } from "@/modules/scheduling/time";
import { runAgentTurn } from "@/modules/agent-engine/orchestrator";
import { verifyReminderLedger } from "./lib/reminder-ledger-smoke";

async function main() {
  const tenantId = process.env.VERIFY_TENANT_ID;
  assert.ok(tenantId && /^[a-zA-Z0-9_-]{1,80}$/.test(tenantId));
  const agent = await prisma.agent.findFirst({ where: { tenantId, archived: false, tenant: { status: "active" } },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], select: { id: true } });
  assert.ok(agent, "Active account with an agent required");
  await verifyReminderLedger(tenantId);
  const prepared = await prepareConfirmationTest(tenantId, agent.id);
  assert.ok(prepared.ok, prepared.ok ? undefined : prepared.error);
  assert.equal(prepared.lead.isTest, true); assert.equal(prepared.conversation.isTest, true);
  const { cfg } = prepared;
  console.log(JSON.stringify({ qrEnabled: cfg.clinicorpQrEnabled, consentRecorded: Boolean(cfg.clinicorpQrConsentAt),
    categoryIds: cfg.clinicorpReminderCategoryIds, reminderCount: cfg.reminders.length, timezone: cfg.timezone }));
  const day = dayKeyInZone(prepared.startsAt, cfg.timezone);
  const [agenda, categories] = await Promise.all([listClinicorpAgenda(tenantId, day, day, cfg.timezone, { fresh: true }), listClinicorpCategories(tenantId)]);
  console.log(JSON.stringify({ clinicorpRead: agenda.status, appointmentCount: agenda.status === "ok" ? agenda.items.length : null,
    authorizedCategoryCount: agenda.status === "ok" ? agenda.items.filter((a) => !a.canceled && a.categoryId && cfg.clinicorpReminderCategoryIds.includes(a.categoryId)).length : null,
    categories: categories.ok ? categories.data : null }));
  // Synthetic appointment has no Clinicorp ID and is excluded from all real reminder queues.
  const testAppointment = await prisma.appointment.create({ data: { tenantId, leadId: prepared.lead.id,
    conversationId: prepared.conversation.id, agentId: agent.id, title: "Teste de confirmação", serviceType: cfg.reminderTypes[0] ?? "Avaliação",
    kind: "evaluation", startsAt: prepared.startsAt, endsAt: new Date(prepared.startsAt.getTime() + 30 * 60_000), source: "agent" } });
  const originalFetch = globalThis.fetch;
  const allowedAi = new Set(["api.openai.com", "api.groq.com", "api.x.ai", "generativelanguage.googleapis.com", "api.anthropic.com", "api.deepseek.com"]);
  let blockedWrites = 0;
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request?.url ?? String(input));
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    if (allowedAi.has(url.hostname) || (url.hostname === "api.clinicorp.com" && method === "GET")) return originalFetch(input, init);
    blockedWrites++; throw new Error("Operator sandbox forbids external messages and calendar writes");
  };
  try {
    assert.equal(prepared.conversation.agentPaused, false, "Existing sandbox paused: resume through UI before running this test");
    const result = await runAgentTurn({ tenantId, agentId: agent.id, leadId: prepared.lead.id, conversationId: prepared.conversation.id,
      userMessage: "Sim, confirmo a consulta informada na mensagem anterior.", skipUsageCheck: true, skipEnabledCheck: true });
    assert.equal(result.status, "ok"); assert.ok(result.reply.trim());
    const saved = await prisma.message.findFirst({ where: { id: result.replyMessageId, conversationId: prepared.conversation.id, role: "assistant" } });
    assert.ok(saved, "Agent response must be saved in the test conversation");
    console.log(JSON.stringify({ sandbox: "ok", conversationId: prepared.conversation.id, responseSaved: true,
      replyCharacters: result.reply.length, toolsUsed: result.toolsUsed, blockedExternalCalls: blockedWrites, realWhatsappDeliveryTested: false }));
  } finally {
    globalThis.fetch = originalFetch;
    await prisma.appointment.deleteMany({ where: { id: testAppointment.id, tenantId, leadId: prepared.lead.id } });
  }
}
main().catch(() => { console.error("CONFIRMATION_VERIFICATION_FAILED; inspect settings, sandbox or AI readiness; no patient message was sent"); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
