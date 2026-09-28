import { requireTenant } from "@/lib/session";
import { requireProductAccess } from "@/lib/require-product";
import { prisma } from "@/lib/prisma";
import { monthKey } from "@/modules/reports/monthly-config";
import { computeMonthlyReport } from "@/modules/reports/monthly";
import { generateMonthlyPdf } from "@/modules/reports/monthly-pdf";

export const runtime = "nodejs";
export async function GET(request: Request) {
  await requireProductAccess();
  const { tenantId } = await requireTenant();
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { status: true } });
  if (tenant?.status !== "active") return new Response("Conta indisponível.", { status: 403 });
  const month = monthKey(new URL(request.url).searchParams.get("mes") ?? undefined);
  const saved = await prisma.monthlyRoiReport.findUnique({ where: { tenantId_month: { tenantId, month } }, select: { status: true } });
  if (saved?.status !== "ready") return new Response("Relatório em revisão pela Mavellium.", { status: 404 });
  const pdf = await generateMonthlyPdf(await computeMonthlyReport(tenantId, month));
  return new Response(Buffer.from(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="fechai-roi-${month}.pdf"`, "Cache-Control": "private, no-store" } });
}
