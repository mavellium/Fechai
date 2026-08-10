import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import { auth } from "@/auth";
import { getImpersonation, type Impersonation } from "@/lib/impersonation";

// Guards de sessão para Server Components / route handlers.
// Regra de ouro: nunca acessar dados sem passar por um destes helpers,
// que garantem tenantId/role antes de qualquer query.

export async function requireSession() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  return session;
}

/** Sobreposição de sessão usada na personificação (ver impersonation.ts). */
function withImpersonation(session: Session, imp: Impersonation): Session {
  return {
    ...session,
    user: {
      ...session.user,
      id: imp.userId,
      email: imp.email,
      role: imp.role,
      tenantId: imp.tenantId,
      impersonating: true,
    },
  };
}

export async function requireTenant() {
  const session = await requireSession();
  // Personificação só vale para quem é SUPERADMIN de verdade — o cookie é
  // assinado e só uma Server Action protegida cria/edita. O resto da sessão
  // segue a sessão real do JWT.
  const impersonation = await getImpersonation();
  if (impersonation && session.user.role === "SUPERADMIN") {
    return { session: withImpersonation(session, impersonation), tenantId: impersonation.tenantId };
  }
  return { session, tenantId: session.user.tenantId };
}

export async function requireSuperadmin() {
  const session = await requireSession();
  if (session.user.role !== "SUPERADMIN") redirect("/inicio");
  return session;
}

// Área do cliente: superadmin não usa o dashboard de tenant — vai direto ao
// painel dele. Na personificação (cookie válido) ele entra no painel do
// cliente com a identidade sobreposta.
export async function requireOwner() {
  const session = await requireSession();
  const impersonation = await getImpersonation();
  if (session.user.role === "SUPERADMIN" && !impersonation) redirect("/admin/contas");
  if (impersonation && session.user.role === "SUPERADMIN") {
    return withImpersonation(session, impersonation);
  }
  return session;
}

// Telas de login/cadastro: quem já está autenticado não deve vê-las de novo.
export async function requireGuest() {
  const session = await auth();
  if (session?.user) {
    redirect(session.user.role === "SUPERADMIN" ? "/admin/contas" : "/inicio");
  }
}
