import { prisma } from "@/lib/prisma";

/**
 * Encontra (ou cria) o lead + conversa de um telefone, dentro do tenant.
 * Sempre isolado por tenantId.
 *
 * `isTest` marca o que veio do chat de teste (sandbox). A marca fica no lead e
 * é espelhada na conversa para as telas filtrarem sem join — sem ela o sandbox
 * era contado como cliente real em Contatos, Conversas e Relatórios.
 */
export async function getOrCreateConversation(
  tenantId: string,
  phone: string,
  name?: string,
  options: { isTest?: boolean } = {},
) {
  const isTest = options.isTest ?? false;

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
        isTest,
        conversation: { create: { tenantId, isTest } },
      },
      include: { conversation: true },
    });
  } else if (!lead.conversation) {
    const conversation = await prisma.conversation.create({
      data: { tenantId, leadId: lead.id, isTest: lead.isTest },
    });
    lead = { ...lead, conversation };
  } else if (isTest && !lead.isTest) {
    // Sandbox de contas antigas: o lead "sandbox" já existia sem a marca.
    // Corrigir na leitura evita depender de o backfill ter rodado.
    await prisma.$transaction([
      prisma.lead.update({ where: { id: lead.id }, data: { isTest: true } }),
      prisma.conversation.update({ where: { id: lead.conversation.id }, data: { isTest: true } }),
    ]);
    lead = { ...lead, isTest: true, conversation: { ...lead.conversation, isTest: true } };
  }

  return { lead, conversation: lead.conversation! };
}

/**
 * Zera o histórico do chat de teste de um agente: apaga a conversa e o lead
 * marcados como teste daquele sandbox. Existe porque testar a persona nova com
 * o histórico da anterior no contexto dá respostas enganosas.
 */
export async function resetTestConversation(tenantId: string, phone: string) {
  await prisma.lead.deleteMany({ where: { tenantId, phone, isTest: true } });
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
