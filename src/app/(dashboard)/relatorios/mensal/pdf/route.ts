import { requireTenant } from "@/lib/session";
import { requireProductAccess } from "@/lib/require-product";
import { prisma } from "@/lib/prisma";
import { monthKey } from "@/modules/reports/monthly-config";
import { loadApprovedReport } from "@/modules/reports/monthly";
import { generateMonthlyPdf } from "@/modules/reports/monthly-pdf";

export const runtime = "nodejs";
export async function GET(request: Request) {
  await requireProductAccess();
  const { tenantId } = await requireTenant();
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { status: true } });
  if (tenant?.status !== "active") return new Response("Conta indisponível.", { status: 403 });
  const month = monthKey(new URL(request.url).searchParams.get("mes") ?? undefined);
  // O PDF da clínica sai só do que foi aprovado: o snapshot do fechamento,
  // gerado aqui no servidor. Rascunho e relatório reaberto não têm PDF.
  const report = await loadApprovedReport(tenantId, month);
  if (!report) return new Response("Relatório em revisão pela Mavellium.", { status: 404 });
  const pdf = await generateMonthlyPdf(report);
  return new Response(Buffer.from(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="fechai-relatorio-${month}.pdf"`, "Cache-Control": "private, no-store" } });
}
