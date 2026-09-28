import { requireSuperadmin } from "@/lib/session";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { monthlyInitialMonth, monthlyAccountPrice, monthlyAgentSource } from "@/modules/reports/monthly-import";
import { computeMonthlyReport } from "@/modules/reports/monthly";
import { MonthlyView, MonthlyRoiSummary } from "@/app/(dashboard)/relatorios/MonthlyView";
import { PageHeader } from "@/components/ui/page-header";
import { ButtonLink } from "@/components/ui/button";
import { MonthPicker } from "@/components/ui/month-picker";
import { ArrowLeft } from "lucide-react";
import { MonthlyRoiEditor } from "./MonthlyRoiEditor";
import { Alert } from "@/components/ui/alert";

export default async function MonthlyRoiPage({ params, searchParams }: {
  params: Promise<{ tenantId: string }>; searchParams: Promise<{ mes?: string }>;
}) {
  await requireSuperadmin();
  const { tenantId } = await params;
  const requested = (await searchParams).mes;
  const latest = requested ? null : await prisma.monthlyRoiReport.findFirst({ where: { tenantId }, orderBy: { month: "desc" }, select: { month: true } });
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { createdAt: true, planKey: true, priceCentsOverride: true } });
  if (!tenant) notFound();
  const month = monthlyInitialMonth(tenant.createdAt, requested, latest?.month);
  const [report, agents] = await Promise.all([
    computeMonthlyReport(tenantId, month),
    prisma.agent.findMany({ where: { tenantId }, orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
      select: { id: true, name: true, isPrimary: true, archived: true, actions: { where: { tenantId, key: "schedule_meeting" }, select: { key: true, config: true } } } }),
  ]);
  const sources = { ...monthlyAccountPrice(tenant), agents: agents.map(monthlyAgentSource) };
  return <div className="space-y-6">
    <PageHeader eyebrow="ROI mensal" title={report.tenantName} description="Confira o retorno, revise as premissas e prepare a entrega ao decisor." />
    <div className="flex flex-wrap items-center justify-between gap-3"><MonthPicker value={month} href={`/admin/relatorios/${tenantId}`} /><ButtonLink href={`/admin/relatorios?mes=${month}`} size="sm" variant="ghost"><ArrowLeft size={14} aria-hidden />Todos os clientes</ButtonLink></div>
    {requested && /^20\d{2}-(0[1-9]|1[0-2])$/.test(requested) && requested < month && <Alert>A conta foi criada em {month.split("-").reverse().join("/")}. Abrimos a primeira competência com dados deste cliente.</Alert>}
    <MonthlyRoiSummary report={report} />
    <MonthlyRoiEditor key={`${month}:${report.status}:${report.revision ?? "new"}`} tenantId={tenantId} report={report} sources={sources} />
    <MonthlyView report={report} showSummary={false} />
  </div>;
}
