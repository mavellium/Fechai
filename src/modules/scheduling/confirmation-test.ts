import { prisma } from "@/lib/prisma";
import { getOrCreateConversation, appendMessage } from "@/modules/agent-engine/conversation";
import { parseScheduleConfig, renderReminder } from "./config";
import { dateInZone, timeInZone } from "./time";

/** Called only by an authenticated action or an explicitly dispatched operator test. */
export async function prepareConfirmationTest(tenantId: string, agentId: string) {
  const agent = await prisma.agent.findFirst({ where: { id: agentId, tenantId, archived: false, tenant: { status: "active" } },
    select: { id: true, actions: { where: { key: "schedule_meeting", enabled: true }, select: { config: true } } } });
  if (!agent) return { ok: false as const, error: "Agente não encontrado nesta conta." };
  const cfg = parseScheduleConfig(agent.actions[0]?.config);
  if (!cfg.reminderEnabled || !cfg.reminders.length) return { ok: false as const, error: "Salve os lembretes antes de testar." };
  const startsAt = new Date(Date.now() + 86_400_000);
  const text = renderReminder(cfg.reminders[0].template, { nome: "Contato de teste", data: dateInZone(startsAt, cfg.timezone), hora: timeInZone(startsAt, cfg.timezone), local: cfg.location });
  if (!text) return { ok: false as const, error: "Preencha o texto da confirmação antes de testar." };
  const { lead, conversation } = await getOrCreateConversation(tenantId, `sandbox:${agent.id}`, "Chat de teste", { isTest: true });
  await appendMessage(conversation.id, "assistant", text, "human");
  return { ok: true as const, lead, conversation, startsAt, cfg };
}
