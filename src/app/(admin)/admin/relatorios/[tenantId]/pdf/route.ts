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
  const query = new URL(request.url).searchParams;
  const month = monthKey(query.get("mes") ?? undefined);
  // `ver=1`: prévia na etapa "Aprovar e entregar", aberta no navegador em vez de baixada.
  const disposition = query.get("ver") === "1" ? "inline" : "attachment";
  const report = await computeMonthlyReport(tenantId, month);
  try {
    const pdf = await generateMonthlyPdf(report);
    return new Response(Buffer.from(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `${disposition}; filename="fechai-roi-${month}.pdf"`, "Cache-Control": "private, no-store" } });
  } catch {
    return new Response("Não foi possível gerar o PDF desta revisão. Confira os textos e tente de novo.", { status: 422, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
