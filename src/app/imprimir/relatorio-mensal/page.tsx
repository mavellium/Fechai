import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { verifyPrintToken } from "@/lib/print-token";
import { computeMonthlyReport } from "@/modules/reports/monthly";
import { MonthlyReportDocument } from "@/app/(dashboard)/relatorios/monthly-v2/MonthlyReportDocument";

export const metadata: Metadata = { title: "Relatório mensal", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/*
 * Rota de impressão do relatório mensal: só o documento, como o decisor
 * recebe. Quem abre é o Chromium do servidor (`monthly-print.ts`), com o token
 * assinado pela rota de PDF, que já conferiu a sessão. Nenhum componente de
 * admin nem nota interna existe nesta árvore: não há o que esconder com CSS.
 */
export default async function MonthlyReportPrintPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const grant = verifyPrintToken((await searchParams).token);
  if (!grant) notFound();
  const report = await computeMonthlyReport(grant.tenantId, grant.month);
  // Uma revisão reaberta entre o pedido e a impressão não pode sair para o cliente.
  if (!report.data || (!grant.draft && report.status !== "ready")) notFound();
  return <main className="bg-white">
    <style>{`
      @page { size: A4; margin: 15mm; }
      html, body { background: #fff; }
      * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    `}</style>
    <MonthlyReportDocument report={report} print />
  </main>;
}
