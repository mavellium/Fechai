import { prisma } from "@/lib/prisma";
import type { ContextMessage } from "./contact-context";

/** Old contacts are not new acquisition. First recorded interaction, with no message text. */
export async function loadConversationStarts(tenantId: string, ids: string[], before: Date, from?: Date | null) {
  const starts = new Map<string, ContextMessage>();
  for (let offset = 0; offset < ids.length; offset += 500) {
    const rows = await prisma.conversation.findMany({
      where: { tenantId, isTest: false, lead: { isTest: false }, id: { in: ids.slice(offset, offset + 500) } },
      select: { id: true, lead: { select: { createdAt: true } }, messages: { where: { role: { in: ["user", "assistant"] }, createdAt: { lt: before } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 1, select: { id: true, role: true, sentBy: true, createdAt: true } } },
    });
    for (const row of rows) if (row.messages[0]) starts.set(row.id, { ...row.messages[0], contactCreatedAt: row.lead?.createdAt });
    if (from) {
      const previous = await prisma.conversation.findMany({
        where: { tenantId, isTest: false, lead: { isTest: false }, id: { in: ids.slice(offset, offset + 500) } },
        select: { id: true, messages: { where: { role: { in: ["user", "assistant"] }, createdAt: { lt: from } },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { id: true, role: true, sentBy: true, createdAt: true } } },
      });
      for (const row of previous) {
        const first = starts.get(row.id), last = row.messages[0];
        if (first && last && last.createdAt < from) first.beforeWindow = last;
      }
    }
  }
  return starts;
}
