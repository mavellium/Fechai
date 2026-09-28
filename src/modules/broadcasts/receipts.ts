import { prisma } from "@/lib/prisma";
import type { MetaDeliveryReceipt } from "@/modules/whatsapp/meta-events";
import { broadcastPhoneVariants } from "./phone";

/** Inbox durável: o callback pode chegar antes de o worker gravar o wamid. */
export async function receiveBroadcastReceipt(
  tenantId: string,
  receipt: MetaDeliveryReceipt,
) {
  const candidate = await prisma.broadcastRecipient.findFirst({
    where: {
      campaign: { tenantId, phoneNumberId: receipt.phoneNumberId },
      phone: { in: broadcastPhoneVariants(receipt.recipientPhone) },
      OR: [{ whatsappMessageId: receipt.messageId }, { status: "sending" }],
    },
    select: { id: true },
  });
  if (!candidate) return;
  await prisma.broadcastReceipt.createMany({
    data: [{ tenantId, ...receipt }],
    skipDuplicates: true,
  });
  await reconcileBroadcastReceipts(tenantId, receipt.messageId);
}

export async function reconcileBroadcastReceipts(
  tenantId: string,
  messageId: string,
) {
  const receipts = await prisma.broadcastReceipt.findMany({
    where: { tenantId, messageId },
    orderBy: { occurredAt: "asc" },
  });
  for (const r of receipts) {
    const where = {
      whatsappMessageId: messageId,
      phone: { in: broadcastPhoneVariants(r.recipientPhone) },
      campaign: { tenantId, phoneNumberId: r.phoneNumberId },
    };
    const matched = await prisma.broadcastRecipient.count({ where });
    if (!matched) {
      // Um envio sem wamid confirmado continua ambíguo; não inferir pelo telefone.
      if (Date.now() - r.receivedAt.getTime() > 10 * 60_000)
        await prisma.broadcastReceipt.update({
          where: { id: r.id },
          data: { appliedAt: new Date() },
        });
      continue;
    }
    // Atualizações condicionais são monotônicas mesmo com callbacks concorrentes/fora de ordem.
    if (r.status === "read")
      await prisma.broadcastRecipient.updateMany({
        where: { ...where, readAt: null },
        data: {
          deliveryStatus: "read",
          readAt: r.occurredAt,
          deliveryError: null,
        },
      });
    if (r.status === "delivered") {
      await prisma.broadcastRecipient.updateMany({
        where: { ...where, deliveredAt: null },
        data: { deliveredAt: r.occurredAt },
      });
      await prisma.broadcastRecipient.updateMany({
        where: { ...where, readAt: null },
        data: { deliveryStatus: "delivered", deliveryError: null },
      });
    }
    if (r.status === "failed")
      await prisma.broadcastRecipient.updateMany({
        where: { ...where, readAt: null, deliveredAt: null },
        data: {
          deliveryStatus: "failed",
          deliveryFailedAt: r.occurredAt,
          deliveryError: r.error,
        },
      });
    if (r.status === "sent")
      await prisma.broadcastRecipient.updateMany({
        where: { ...where, deliveryStatus: null },
        data: { deliveryStatus: "sent" },
      });
    await prisma.broadcastReceipt.update({
      where: { id: r.id },
      data: { appliedAt: new Date() },
    });
  }
}
