import { prisma } from "@/lib/prisma";

// Encontra (ou cria) o lead + conversa de um telefone, dentro do tenant.
// Sempre isolado por tenantId.
export async function getOrCreateConversation(tenantId: string, phone: string, name?: string) {
  let lead = await prisma.lead.findFirst({
    where: { tenantId, phone },
    include: { conversation: true },
  });

  if (!lead) {
    lead = await prisma.lead.create({
      data: {
        tenantId,
        phone,
        name,
        conversation: { create: { tenantId } },
      },
      include: { conversation: true },
    });
  } else if (!lead.conversation) {
    const conversation = await prisma.conversation.create({ data: { tenantId, leadId: lead.id } });
    lead = { ...lead, conversation };
  }

  return { lead, conversation: lead.conversation! };
}

export async function appendMessage(
  conversationId: string,
  role: "user" | "assistant" | "system",
  content: string,
) {
  await prisma.message.create({ data: { conversationId, role, content } });
  if (role === "user") {
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { lastInboundAt: new Date() },
    });
  }
}

export async function getRecentMessages(conversationId: string, limit = 10) {
  const rows = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { role: true, content: true },
  });
  return rows.reverse();
}
