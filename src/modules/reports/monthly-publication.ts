import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** Rascunhos e registros sem snapshot nunca viram opções no painel do cliente. */
export async function publishedMonthlyMonths(tenantId: string): Promise<string[]> {
  const reports = await prisma.monthlyRoiReport.findMany({
    where: { tenantId, status: "ready", snapshot: { not: Prisma.DbNull } },
    select: { month: true }, orderBy: { month: "desc" },
  });
  return reports.map((report) => report.month);
}

export function selectPublishedMonth(months: string[], requested?: string): string | null {
  return requested && months.includes(requested) ? requested : months[0] ?? null;
}
