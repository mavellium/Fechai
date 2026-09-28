import { requireSuperadmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { monthKey } from "@/modules/reports/monthly-config";
import { ButtonLink } from "@/components/ui/button";
import { MonthPicker } from "@/components/ui/month-picker";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Building2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";

export default async function MonthlyReportsPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  await requireSuperadmin();
  const month = monthKey((await searchParams).mes);
  const tenants = await prisma.tenant.findMany({ where: { status: "active", users: { some: { usesProduct: true, role: "OWNER" } } }, orderBy: { name: "asc" },
    select: { id: true, name: true, monthlyRoiReports: { where: { month }, select: { status: true, sentAt: true, meetingAt: true } } } });
  return <div className="space-y-6"><PageHeader eyebrow="Mavellium" title="Relatórios mensais de ROI" description="Revisar, exportar e entregar até dia 5. Depois, apresentar em uma reunião curta com o decisor." />
    <MonthPicker value={month} href="/admin/relatorios" />
    <Card><CardTitle action={<Badge>{tenants.length} clínicas</Badge>}>Acompanhamento das entregas</CardTitle>{tenants.length ? <DataTable caption="Revisão e entrega dos relatórios por clínica" head={["Clínica", "Revisão", "Entrega", "Reunião", "Ação"]} rows={tenants.map((t) => {
      const report = t.monthlyRoiReports[0];
      return { id: t.id, cells: [t.name, <Badge key="status" tone={report?.status === "ready" ? "success" : "neutral"}>{report?.status === "ready" ? "Fechado" : report ? "Em revisão" : "Não iniciado"}</Badge>, report?.sentAt ? "Enviado" : "Até dia 5", report?.meetingAt ? "Realizada" : "Pendente", <ButtonLink key="link" href={`/admin/relatorios/${t.id}?mes=${month}`} size="sm" variant="outline">{report?.status === "ready" ? "Ver relatório" : "Revisar"}</ButtonLink>] };
    })} /> : <EmptyState icon={Building2} title="Nenhuma clínica ativa" description="As contas que utilizam o produto aparecerão aqui para a revisão mensal." />}</Card>
  </div>;
}
