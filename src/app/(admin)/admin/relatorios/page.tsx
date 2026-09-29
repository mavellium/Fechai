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
  const tenants = await prisma.tenant.findMany({
    where: { status: "active", users: { some: { usesProduct: true, role: "OWNER" } } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      createdAt: true,
      monthlyRoiReports: { where: { month }, select: { status: true } },
    },
  });
  const entryDate = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeZone: "America/Sao_Paulo",
  });

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Mavellium" title="Relatórios" />
      <MonthPicker value={month} href="/admin/relatorios" />
      <Card>
        <CardTitle action={<Badge>Por clientes</Badge>}>Acompanhamento dos relatórios</CardTitle>
        {tenants.length ? (
          <DataTable
            caption="Revisão dos relatórios por cliente"
            head={["Cliente", "Data de entrada do cliente", "Revisão", "Ação"]}
            headerAlign="center"
            columnAlign={["left", "center", "center", "center"]}
            rows={tenants.map((tenant) => {
              const report = tenant.monthlyRoiReports[0];
              return {
                id: tenant.id,
                cells: [
                  tenant.name,
                  <time key="entry" dateTime={tenant.createdAt.toISOString()} className="whitespace-nowrap">
                    {entryDate.format(tenant.createdAt)}
                  </time>,
                  <Badge key="status" tone={report?.status === "ready" ? "success" : "neutral"}>
                    {report?.status === "ready" ? "Fechado" : report ? "Em revisão" : "Não iniciado"}
                  </Badge>,
                  <ButtonLink key="link" href={`/admin/relatorios/${tenant.id}?mes=${month}`} size="sm" variant="outline">
                    {report?.status === "ready" ? "Ver relatório" : "Revisar"}
                  </ButtonLink>,
                ],
              };
            })}
          />
        ) : (
          <EmptyState icon={Building2} title="Nenhum cliente ativo" description="As contas que utilizam o produto aparecerão aqui para a revisão mensal." />
        )}
      </Card>
    </div>
  );
}
