import { redirect } from "next/navigation";
import { auth } from "@/auth";

// Guards de sessão para Server Components / route handlers.
// Regra de ouro: nunca acessar dados sem passar por um destes helpers,
// que garantem tenantId/role antes de qualquer query.

export async function requireSession() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  return session;
}

export async function requireTenant() {
  const session = await requireSession();
  return { session, tenantId: session.user.tenantId };
}

export async function requireSuperadmin() {
  const session = await requireSession();
  if (session.user.role !== "SUPERADMIN") redirect("/inicio");
  return session;
}

// Área do cliente: superadmin não usa o dashboard de tenant — vai direto ao painel dele.
export async function requireOwner() {
  const session = await requireSession();
  if (session.user.role === "SUPERADMIN") redirect("/admin/contas");
  return session;
}

// Telas de login/cadastro: quem já está autenticado não deve vê-las de novo.
export async function requireGuest() {
  const session = await auth();
  if (session?.user) {
    redirect(session.user.role === "SUPERADMIN" ? "/admin/contas" : "/inicio");
  }
}
