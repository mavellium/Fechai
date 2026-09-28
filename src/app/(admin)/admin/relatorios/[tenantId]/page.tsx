import { requireSuperadmin } from "@/lib/session";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { monthKey } from "@/modules/reports/monthly-config";
import { computeMonthlyReport } from "@/modules/reports/monthly";
import { MonthlyView } from "@/app/(dashboard)/relatorios/MonthlyView";
import { PageHeader } from "@/components/ui/page-header";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MonthlyRoiEditor } from "./MonthlyRoiEditor";

export default async function MonthlyRoiPage({ params, searchParams }: {
  params: Promise<{ tenantId: string }>; searchParams: Promise<{ mes?: string }>;
}) {
  await requireSuperadmin();
  const { tenantId } = await params;
  const month = monthKey((await searchParams).mes);
  if (!await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } })) notFound();
  const report = await computeMonthlyReport(tenantId, month);
  return <div className="space-y-6">
    <PageHeader eyebrow="relatórios mensais · P-79" title={report.tenantName} description={`ROI estimado de ${report.label}. Entrega até dia 5 do mês seguinte.`} />
    <div className="flex flex-wrap items-end justify-between gap-3"><form className="flex items-end gap-3"><label className="text-sm">Competência<Input type="month" name="mes" defaultValue={month} required /></label><Button type="submit" variant="outline">Ver mês</Button></form><ButtonLink href="/admin/relatorios" variant="ghost">Todas as clínicas</ButtonLink></div>
    <p className="text-sm">{report.status === "ready" ? "Fechado para entrega" : "Em revisão"} · prazo: {new Intl.DateTimeFormat("pt-BR", { timeZone: report.assumptions.timezone }).format(new Date(report.dueAt))}{report.sentAt ? " · enviado ao decisor" : " · envio pendente"}{report.meetingAt ? " · apresentado em reunião" : " · reunião pendente"}</p>
    <MonthlyRoiEditor key={`${month}:${report.status}`} tenantId={tenantId} report={report} />
    <MonthlyView report={report} />
  </div>;
}
