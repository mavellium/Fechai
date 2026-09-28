import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/session";
import { requireProductAccess } from "@/lib/require-product";
import { readAgendaPulse } from "@/modules/scheduling/agenda-pulse";

/**
 * Versão da agenda do mês, para a `/agenda` ao vivo (`AgendaLiveRefresh`).
 *
 * Rota, e não Server Action, de propósito: a Server Action entra na fila do
 * roteador e seguraria os cliques da tela durante a releitura do Clinicorp.
 * Mesma guarda da página (produto + conta), porque a resposta deriva da agenda.
 */
export async function GET(request: Request) {
  await requireProductAccess();
  const { tenantId } = await requireTenant();

  const params = new URL(request.url).searchParams;
  const year = Number(params.get("ano"));
  const month = Number(params.get("mes"));
  if (!Number.isInteger(year) || year < 1970 || year > 2999 || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "Mês inválido." }, { status: 400 });
  }

  const pulse = await readAgendaPulse(tenantId, year, month);
  return NextResponse.json(pulse, { headers: { "Cache-Control": "private, no-store" } });
}
