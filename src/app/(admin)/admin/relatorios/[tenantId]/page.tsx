import { requireSuperadmin } from "@/lib/session";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { monthKey } from "@/modules/reports/monthly-config";
import { computeMonthlyReport } from "@/modules/reports/monthly";
import { MonthlyView, MonthlyRoiSummary } from "@/app/(dashboard)/relatorios/MonthlyView";
import { PageHeader } from "@/components/ui/page-header";
import { ButtonLink } from "@/components/ui/button";
import { MonthPicker } from "@/components/ui/month-picker";
import { ArrowLeft } from "lucide-react";
import { MonthlyRoiEditor } from "./MonthlyRoiEditor";

export default async function MonthlyRoiPage({ params, searchParams }: {
  params: Promise<{ tenantId: string }>; searchParams: Promise<{ mes?: string }>;
}) {
  await requireSuperadmin();
  const { tenantId } = await params;
  const requested = (await searchParams).mes;
  const latest = requested ? null : await prisma.monthlyRoiReport.findFirst({ where: { tenantId }, orderBy: { month: "desc" }, select: { month: true } });
  const month = monthKey(requested ?? latest?.month);
  if (!await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } })) notFound();
  const report = await computeMonthlyReport(tenantId, month);
  return <div className="space-y-6">
    <PageHeader eyebrow="ROI mensal" title={report.tenantName} description="Confira o retorno, revise as premissas e prepare a entrega ao decisor." />
    <div className="flex flex-wrap items-center justify-between gap-3"><MonthPicker value={month} href={`/admin/relatorios/${tenantId}`} /><ButtonLink href={`/admin/relatorios?mes=${month}`} size="sm" variant="ghost"><ArrowLeft size={14} aria-hidden />Todas as clínicas</ButtonLink></div>
    <MonthlyRoiSummary report={report} />
    <MonthlyRoiEditor key={`${month}:${report.status}:${report.revision ?? "new"}`} tenantId={tenantId} report={report} />
    <MonthlyView report={report} showSummary={false} />
  </div>;
}
