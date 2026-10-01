import { prisma } from "@/lib/prisma";
import { declaredCity, type CityDeclaration } from "./historical-city";

/** Server-only reading; message text never leaves this module and nothing is persisted on GET. */
export async function loadHistoricalCities(tenantId: string, conversationIds: string[], before: Date) {
  const found = new Map<string, CityDeclaration>();
  for (let offset = 0; offset < conversationIds.length; offset += 200) {
    const ids = conversationIds.slice(offset, offset + 200);
    const previous = new Map<string, { role: string; content: string }>();
    let cursor: string | undefined;
    for (;;) {
      const messages = await prisma.message.findMany({
        where: { conversationId: { in: ids }, conversation: { tenantId, isTest: false, lead: { isTest: false } },
          createdAt: { lt: before }, role: { in: ["user", "assistant"] } },
        select: { id: true, conversationId: true, role: true, content: true, createdAt: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 1000,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      for (const message of messages) {
        const declaration = declaredCity(message, previous.get(message.conversationId));
        if (declaration) found.set(message.conversationId, declaration);
        previous.set(message.conversationId, message);
      }
      if (messages.length < 1000) break;
      cursor = messages.at(-1)!.id;
    }
  }
  return found;
}
