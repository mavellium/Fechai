import { prisma } from "@/lib/prisma";
import { NOT_IMPORTED } from "@/modules/scheduling/source";
import { broadcastPhoneVariants } from "./phone";
export const ATTRIBUTION_DAYS = 7;

/** Último disparo antes da resposta, em até 7 dias. Não atribui testes. */
export async function recordBroadcastResponse(
  tenantId: string,
  phone: string,
  messageId: string,
  eventTime?: Date,
) {
  const message = await prisma.message.findFirst({
    where: {
      whatsappMessageId: messageId,
      role: "user",
      conversation: { tenantId, isTest: false },
    },
    select: {
      id: true,
      createdAt: true,
      conversation: {
        select: { lead: { select: { id: true, status: true } } },
      },
    },
  });
  if (!message) return;
  const occurredAt = eventTime ?? message.createdAt;
  const since = new Date(occurredAt.getTime() - ATTRIBUTION_DAYS * 86400_000);
  const recipient = await prisma.broadcastRecipient.findFirst({
    where: {
      campaign: { tenantId },
      status: "sent",
      phone: { in: broadcastPhoneVariants(phone) },
      sentAt: { gte: since, lte: occurredAt },
    },
    orderBy: [{ sentAt: "desc" }, { id: "desc" }],
  });
  if (!recipient?.sentAt || recipient.isTest) return;
  await prisma.broadcastRecipient.updateMany({
    where: { id: recipient.id, repliedAt: null },
    data: { repliedAt: occurredAt, firstReplyMessageId: messageId },
  });
  const qualified =
    ["hot", "scheduled"].includes(message.conversation.lead.status) &&
    !["hot", "scheduled"].includes(recipient.leadStatusAtSend ?? "");
  if (qualified)
    await prisma.broadcastRecipient.updateMany({
      where: { id: recipient.id, qualifiedAt: null },
      data: { qualifiedAt: occurredAt },
    });
  const appointment = await prisma.appointment.findFirst({
    where: {
      tenantId,
      // A importada do Clinicorp ganha `createdAt` quando chega aqui, não
      // quando foi marcada: uma consulta de meses atrás pareceria "criada após
      // o envio" e seria atribuída ao Disparo.
      ...NOT_IMPORTED,
      leadId: message.conversation.lead.id,
      status: { not: "canceled" },
      createdAt: {
        gte: recipient.sentAt,
        lte: new Date(
          recipient.sentAt.getTime() + ATTRIBUTION_DAYS * 86400_000,
        ),
      },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (appointment)
    await prisma.broadcastRecipient.updateMany({
      where: { id: recipient.id, appointmentId: null },
      data: { appointmentId: appointment.id },
    });
}
