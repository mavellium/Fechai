import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getBroadcastWorkerHealth } from "./health";

export type BroadcastFilter = {
  query?: string;
  status?: string;
  page?: number;
};
export async function listBroadcastPage(
  tenantId: string,
  filter: BroadcastFilter = {},
) {
  const where: Prisma.BroadcastCampaignWhereInput = {
    tenantId,
    ...(filter.query
      ? {
          name: {
            contains: String(filter.query).slice(0, 100),
            mode: "insensitive",
          },
        }
      : {}),
    ...(["draft", "queued", "paused", "completed", "cancelled"].includes(
      filter.status ?? "",
    )
      ? { status: filter.status }
      : {}),
  };
  const total = await prisma.broadcastCampaign.count({ where });
  const pages = Math.max(1, Math.ceil(total / 20));
  const page = Math.min(
    pages,
    Math.max(1, Number.isInteger(filter.page) ? filter.page! : 1),
  );
  const [campaigns, health] = await Promise.all([
    prisma.broadcastCampaign.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 20,
      skip: (page - 1) * 20,
      select: {
        id: true,
        name: true,
        status: true,
        createdAt: true,
        error: true,
        scheduledAt: true,
        timezone: true,
        windowStart: true,
        windowEnd: true,
        nextAttemptAt: true,
        confirmedByLabel: true,
        confirmedAt: true,
        recipients: {
          where: { isTest: false },
          select: {
            status: true,
            deliveryStatus: true,
            repliedAt: true,
            qualifiedAt: true,
            appointmentId: true,
          },
        },
      },
    }),
    getBroadcastWorkerHealth(),
  ]);
  const items = campaigns.map(
    ({
      recipients,
      createdAt,
      scheduledAt,
      nextAttemptAt,
      confirmedAt,
      ...campaign
    }) => ({
      ...campaign,
      createdAt: createdAt.toISOString(),
      scheduledAt: scheduledAt?.toISOString() ?? null,
      nextAttemptAt: nextAttemptAt.toISOString(),
      confirmedAt: confirmedAt?.toISOString() ?? null,
      total: recipients.length,
      sent: recipients.filter((r) => r.status === "sent").length,
      failed: recipients.filter((r) => r.status === "failed").length,
      unknown: recipients.filter((r) => r.status === "unknown").length,
      skipped: recipients.filter(
        (r) => r.status === "skipped" || r.status === "cancelled",
      ).length,
      delivered: recipients.filter((r) =>
        ["delivered", "read"].includes(r.deliveryStatus ?? ""),
      ).length,
      read: recipients.filter((r) => r.deliveryStatus === "read").length,
      deliveryFailed: recipients.filter((r) => r.deliveryStatus === "failed")
        .length,
      replies: recipients.filter((r) => r.repliedAt).length,
      opportunities: recipients.filter((r) => r.qualifiedAt).length,
      appointments: recipients.filter((r) => r.appointmentId).length,
    }),
  );
  return { items, page, pages, total, health };
}
export async function listBroadcasts(tenantId: string) {
  return (await listBroadcastPage(tenantId)).items;
}
export type BroadcastPage = Awaited<ReturnType<typeof listBroadcastPage>>;
export type BroadcastSummary = BroadcastPage["items"][number];
