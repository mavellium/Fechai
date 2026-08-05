import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/session";
import { connectGoogleCalendar } from "@/modules/scheduling/google";

/** Volta do Google e sempre termina em /agenda, com o resultado na URL. */
function backToAgenda(status: string) {
  const base = (process.env.NEXTAUTH_URL ?? "http://localhost:3001").replace(/\/$/, "");
  return NextResponse.redirect(`${base}/agenda?google=${status}`);
}

export async function GET(req: Request) {
  // A sessão manda, não o `state`: mesmo que alguém forje a volta com o state
  // de outra conta, o token é gravado no tenant de quem está logado. O `state`
  // fica só como conferência.
  const { tenantId } = await requireTenant();

  const params = new URL(req.url).searchParams;
  const code = params.get("code");
  const state = params.get("state");

  if (params.get("error") || !code) return backToAgenda("cancelado");
  if (state && state !== tenantId) return backToAgenda("erro");

  try {
    await connectGoogleCalendar(tenantId, code);
    return backToAgenda("conectado");
  } catch (err) {
    console.error("[google-calendar] callback falhou", err);
    return backToAgenda("erro");
  }
}
