import { prisma } from "@/lib/prisma";
import { broadcastPhoneVariants } from "./phone";
export async function recentlyContacted(
  tenantId: string,
  phones: string[],
  excludeCampaignId?: string,
) {
  const rows = await prisma.broadcastRecipient.findMany({
    where: {
      campaign: { tenantId },
      campaignId: { not: excludeCampaignId },
      isTest: false,
      status: "sent",
      sentAt: { gte: new Date(Date.now() - 7 * 86400_000) },
      phone: { in: [...new Set(phones.flatMap(broadcastPhoneVariants))] },
    },
    select: { phone: true },
    distinct: ["phone"],
  });
  const found = new Set(rows.flatMap((r) => broadcastPhoneVariants(r.phone)));
  return phones.filter((p) => found.has(p));
}
