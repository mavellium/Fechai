import { requireSuperadmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { monthKey } from "@/modules/reports/monthly-config";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";

export default async function MonthlyReportsPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  await requireSuperadmin();
  const month = monthKey((await searchParams).mes);
  const tenants = await prisma.tenant.findMany({ where: { status: "active", users: { some: { usesProduct: true, role: "OWNER" } } }, orderBy: { name: "asc" },
    select: { id: true, name: true, monthlyRoiReports: { where: { month }, select: { status: true, sentAt: true, meetingAt: true } } } });
  return <div className="space-y-6"><PageHeader eyebrow="Mavellium" title="Relatórios mensais de ROI" description="Revisar, exportar e entregar até dia 5. Depois, apresentar em uma reunião curta com o decisor." />
    <form className="flex items-end gap-3"><label className="text-sm">Competência<Input type="month" name="mes" defaultValue={month} required /></label><Button type="submit" variant="outline">Ver mês</Button></form>
    <Card><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="py-3">Clínica</th><th>Revisão</th><th>Entrega</th><th>Reunião</th><th><span className="sr-only">Abrir</span></th></tr></thead><tbody>{tenants.map((t) => {
      const report = t.monthlyRoiReports[0];
      return <tr key={t.id} className="border-t border-white/10"><td className="py-4">{t.name}</td><td>{report?.status === "ready" ? "Fechado" : "Pendente"}</td><td>{report?.sentAt ? "Enviado" : "Até dia 5"}</td><td>{report?.meetingAt ? "Realizada" : "Pendente"}</td><td><ButtonLink href={`/admin/relatorios/${t.id}?mes=${month}`} size="sm" variant="outline">Revisar</ButtonLink></td></tr>;
    })}</tbody></table></div></Card>
  </div>;
}
