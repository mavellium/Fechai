import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/session";
import { googleAuthUrl, isGoogleCalendarConfigured } from "@/modules/scheduling/google";

/**
 * Começa o consentimento do Google Agenda: manda o usuário para a tela do
 * Google levando o tenantId no `state`.
 *
 * O `state` é o tenant da SESSÃO (não um id vindo do cliente) — é ele que o
 * callback usa para saber de quem é o token que voltou.
 */
export async function GET() {
  const { tenantId } = await requireTenant();

  if (!isGoogleCalendarConfigured()) {
    return NextResponse.redirect(
      new URL("/agenda?google=indisponivel", process.env.NEXTAUTH_URL ?? "http://localhost:3001"),
    );
  }

  return NextResponse.redirect(googleAuthUrl(tenantId));
}
