import { prisma } from "@/lib/prisma";

export type ContactPurpose = "contact_reminder" | "contact_campaign" | "contact_followup";
const purposes = new Set<string>(["contact_reminder", "contact_campaign", "contact_followup"]);
export function contextEventMessageId(kind: string, dedupKey: string): string | undefined {
  return purposes.has(kind) && dedupKey.startsWith("contact-context:") ? dedupKey.split(":").at(-1) : undefined;
}

/** Observe the actual operation, never interpret the message or interrupt sending. */
export async function recordMessageContext(tenantId: string, messageId: string | undefined, kind: ContactPurpose) {
  if (!messageId) return;
  try {
    const message = await prisma.message.findFirst({ where: { id: messageId, role: "assistant",
      conversation: { tenantId, isTest: false, lead: { isTest: false } } }, select: { id: true, conversationId: true, createdAt: true } });
    if (!message) return;
    const dedupKey = `contact-context:${tenantId}:${message.conversationId}:${kind}:${message.id}`;
    await prisma.reportEvent.upsert({ where: { dedupKey }, update: {}, create: {
      tenantId, conversationId: message.conversationId, kind, dedupKey, createdAt: message.createdAt,
    } });
  } catch { console.error("[reports] contexto do envio não registrado"); }
}
