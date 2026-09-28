import { requireSuperadmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { monthKey } from "@/modules/reports/monthly-config";
import { computeMonthlyReport } from "@/modules/reports/monthly";
import { generateMonthlyPdf } from "@/modules/reports/monthly-pdf";

export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  await requireSuperadmin();
  const { tenantId } = await params;
  if (!await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } })) return new Response("Clínica não encontrada.", { status: 404 });
  const month = monthKey(new URL(request.url).searchParams.get("mes") ?? undefined);
  const report = await computeMonthlyReport(tenantId, month);
  try {
    const pdf = await generateMonthlyPdf(report);
    return new Response(Buffer.from(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="fechai-roi-${month}.pdf"`, "Cache-Control": "private, no-store" } });
  } catch {
    return new Response("O conteúdo excedeu uma página. Reduza os textos de revisão ou os nomes nas premissas antes de exportar.", { status: 422 });
  }
}
