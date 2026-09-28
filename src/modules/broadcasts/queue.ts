import type { BroadcastCampaign, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** Uma vaga por tenant, ordenada pelo cursor da última oportunidade de envio. */
export function dueBroadcastCampaigns(
  now: Date,
  db: Pick<Prisma.TransactionClient, "$queryRaw"> = prisma,
) {
  return db.$queryRaw<BroadcastCampaign[]>`
    SELECT * FROM (
      SELECT DISTINCT ON ("tenantId") * FROM "BroadcastCampaign"
      WHERE status = 'queued' AND "nextAttemptAt" <= ${now}
      ORDER BY "tenantId", "nextAttemptAt", id
    ) due ORDER BY "nextAttemptAt", id LIMIT 20
  `;
}
