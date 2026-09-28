import "dotenv/config";
import { prisma } from "../src/lib/prisma";
async function main() {
  const clinics = await prisma.tenant.findMany({ where: { name: { contains: "sorriso", mode: "insensitive" } },
    select: { id: true, name: true, status: true, reportTrackingStartedAt: true,
      _count: { select: { leads: { where: { isTest: false } }, appointments: { where: { lead: { isTest: false } } } } },
      monthlyRoiReports: { select: { month: true, status: true, sentAt: true, meetingAt: true } } } });
  console.log(JSON.stringify({ clinics }, null, 2));
}
main().catch(() => { console.error("Não foi possível conferir o banco local."); process.exitCode = 1; }).finally(() => prisma.$disconnect());
