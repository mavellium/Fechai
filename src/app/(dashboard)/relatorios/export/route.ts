import { LEAD_STATUS } from "../../conversas/leadStatus";
import { requireTenant } from "@/lib/session";
import { computePeriodReport, resolveRange, type PeriodKey } from "@/modules/reports/service";

/**
 * Exporta o relatório atual como CSV (separador `;` + BOM, para abrir direto no
 * Excel brasileiro). Reusa `resolveRange` da página, então `?periodo=` e
 * `?de=&ate=` se comportam igual.
 */
export async function GET(request: Request) {
  const { tenantId } = await requireTenant();
  const url = new URL(request.url);
  const periodo = url.searchParams.get("periodo") ?? "30";
  const de = url.searchParams.get("de") ?? undefined;
  const ate = url.searchParams.get("ate") ?? undefined;
  const valid: PeriodKey[] = ["hoje", "7", "30", "mes", "ano", "tudo"];
  const key = (valid as string[]).includes(periodo) ? (periodo as PeriodKey) : "30";

  const range = resolveRange(key, de, ate);
  const r = await computePeriodReport(tenantId, range);
  const prev = r.kpis.prev;

  const cell = (v: string | number) => {
    const s = String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const rows = (label: string, value: number, previous: number | undefined): string[] => [
    `${cell(label)};${value};${previous === undefined ? "" : previous}`,
  ];

  const lines = [
    "indicador;valor;periodo_anterior",
    ...rows("Conversas ativas", r.kpis.conversations, prev?.conversations),
    ...rows("Leads novos", r.kpis.leads, prev?.leads),
    ...rows("Agendamentos", r.kpis.scheduled, prev?.scheduled),
    ...rows("Mensagens recebidas", r.kpis.inbound, prev?.inbound),
    ...rows("Mensagens enviadas", r.kpis.outbound, prev?.outbound),
    ...rows("Taxa de resposta (%)", Math.round(r.kpis.responseRate * 100), prev ? Math.round(prev.responseRate * 100) : undefined),
    ...rows("Leads quentes (agora)", r.kpis.hotLeads, undefined),
    ...rows("Precisam de você (agora)", r.kpis.needsHuman, undefined),
    "",
    "bucket;recebidas;enviadas",
    ...r.flow.map((p) => `${cell(p.label)};${p.inbound};${p.outbound}`),
    "",
    "bucket;so_ia;precisou_humano",
    ...r.attendance.map((p) => `${cell(p.label)};${p.ai};${p.human}`),
    "",
    "bucket;ia;humano",
    ...r.closed.map((p) => `${cell(p.label)};${p.ai};${p.human}`),
    "",
    "status;leads_novos",
    ...r.byStatus.map((s) => `${cell(LEAD_STATUS[s.status]?.label ?? s.status)};${s.count}`),
  ];

  const csv = "\uFEFF" + lines.join("\r\n") + "\r\n";
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="relatorio-${de ?? key}.csv"`,
    },
  });
}
