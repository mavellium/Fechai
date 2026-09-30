import { requireSuperadmin } from "@/lib/session";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { monthlyInitialMonth, monthlyAccountPrice, monthlyAgentSource } from "@/modules/reports/monthly-import";
import { computeMonthlyReport, loadMonthlyCaseCandidates } from "@/modules/reports/monthly";
import { MonthlyView, MonthlyRoiSummary } from "@/app/(dashboard)/relatorios/MonthlyView";
import { PageHeader } from "@/components/ui/page-header";
import { ButtonLink } from "@/components/ui/button";
import { MonthPicker } from "@/components/ui/month-picker";
import { ArrowLeft } from "lucide-react";
import { MonthlyCloseWizard } from "./MonthlyRoiEditor";
import { MonthlyPendencyCenter } from "./MonthlyPendencyCenter";
import { buildPendencyBoard } from "@/modules/reports/monthly-pendencies";
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
  const open = report.status !== "ready";
  // Sugestões para o caso do mês dependem do fuso e dos agentes da revisão.
  const [caseCandidates, tracking, owner] = open ? await Promise.all([
    loadMonthlyCaseCandidates(tenantId, month, report.assumptions),
    prisma.monthlyRoiPendency.findMany({ where: { tenantId, month } }),
    prisma.user.findFirst({ where: { tenantId, role: "OWNER" }, orderBy: { createdAt: "asc" }, select: { name: true, email: true, phone: true } }),
  ]) : [[], [], null];
  const sources = { ...monthlyAccountPrice(tenant), agents: agents.map(monthlyAgentSource) };
  return <div className="space-y-6">
    <PageHeader eyebrow="Relatórios" title={report.tenantName} description="Feche o mês em cinco etapas: conferir os dados, resolver pendências, validar o retorno, escrever a análise e entregar ao decisor." />
    <div className="flex flex-wrap items-center justify-between gap-3"><MonthPicker value={month} href={`/admin/relatorios/${tenantId}`} /><ButtonLink href={`/admin/relatorios?mes=${month}`} size="sm" variant="ghost"><ArrowLeft size={14} aria-hidden />Todos os clientes</ButtonLink></div>
    {requested && /^20\d{2}-(0[1-9]|1[0-2])$/.test(requested) && requested < month && <Alert>A conta foi criada em {month.split("-").reverse().join("/")}. Abrimos a primeira competência com dados deste cliente.</Alert>}
    {/* Com o fechamento aberto, as limitações estão nas etapas; o resumo mostra só o retorno. */}
    <MonthlyRoiSummary report={report} showMissing={!open} />
    {/* Os registros ficam só nas tabelas do painel: o editor não os usa e eles dobrariam o que vai ao navegador. */}
    <MonthlyCloseWizard key={month} tenantId={tenantId} report={{ ...report, evidence: undefined }} sources={sources} caseCandidates={caseCandidates}
      pendencyCenter={open ? <MonthlyPendencyCenter tenantId={tenantId} month={month} clinicName={report.tenantName} monthLabel={report.label}
        dueAt={report.dueAt} now={new Date().toISOString()} timezone={report.assumptions.timezone}
        rows={buildPendencyBoard({ metrics: report.current, config: report.assumptions, monthName: report.label.split(" de ")[0], tracking })}
        contact={{ name: owner?.name ?? null, email: owner?.email ?? null, phone: owner?.phone ?? null }} /> : undefined} />
    <MonthlyView report={report} showSummary={false} />
  </div>;
}
