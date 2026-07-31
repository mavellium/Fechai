import { prisma } from "@/lib/prisma";

export const FEEDBACK_STATUSES = ["new", "read", "resolved"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

// Criado pelo cliente — sempre vinculado ao próprio tenantId.
export async function createFeedback(tenantId: string, message: string, rating?: number | null) {
  return prisma.feedback.create({
    data: {
      tenantId,
      message,
      rating: rating && rating >= 1 && rating <= 5 ? rating : null,
    },
  });
}

// Uso do admin (cross-tenant). A autorização (SUPERADMIN) é garantida na rota.
export async function listFeedbacks(filter?: { tenantId?: string; status?: string }) {
  return prisma.feedback.findMany({
    where: {
      ...(filter?.tenantId ? { tenantId: filter.tenantId } : {}),
      ...(filter?.status ? { status: filter.status } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { tenant: { select: { id: true, name: true } } },
  });
}

export async function setFeedbackStatus(feedbackId: string, status: FeedbackStatus) {
  await prisma.feedback.update({ where: { id: feedbackId }, data: { status } });
}
