import { requireTenant } from "@/lib/session";
import { requireProductAccess } from "@/lib/require-product";
import { prisma } from "@/lib/prisma";
import { monthKey } from "@/modules/reports/monthly-config";
import { computeMonthlyReport } from "@/modules/reports/monthly";
import { generateMonthlyPdf } from "@/modules/reports/monthly-pdf";
import { monthlyPdfFilename, monthlyPrintPath, printMonthlyPdf } from "@/modules/reports/monthly-print";

export const runtime = "nodejs";
export async function GET(request: Request) {
  await requireProductAccess();
  const { tenantId } = await requireTenant();
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { status: true } });
  if (tenant?.status !== "active") return new Response("Conta indisponível.", { status: 403 });
  const month = monthKey(new URL(request.url).searchParams.get("mes") ?? undefined);
  const saved = await prisma.monthlyRoiReport.findUnique({ where: { tenantId_month: { tenantId, month } }, select: { status: true } });
  if (saved?.status !== "ready") return new Response("Relatório em revisão pela Mavellium.", { status: 404 });
  const report = await computeMonthlyReport(tenantId, month);
  if (report.data) {
    // Relatório v2: o PDF é a página impressa pelo Chromium do servidor.
    const grant = { tenantId, month, draft: false };
    try {
      const pdf = await printMonthlyPdf(grant, new URL(request.url).origin);
      return new Response(Buffer.from(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${monthlyPdfFilename(report.tenantName, month, report.snapshotVersion, false)}"`, "Cache-Control": "private, no-store" } });
    } catch (error) {
      // Sem navegador no servidor, a pessoa ainda salva o PDF pela própria página.
      console.error("[monthly] impressão do PDF falhou", error);
      return Response.redirect(new URL(monthlyPrintPath(grant), request.url), 303);
    }
  }
  const pdf = await generateMonthlyPdf(report);
  return new Response(Buffer.from(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="fechai-roi-${month}.pdf"`, "Cache-Control": "private, no-store" } });
}
