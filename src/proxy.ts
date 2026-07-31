import { NextResponse } from "next/server";
import { auth } from "@/auth";

// Checagem otimista (via cookie de sessão, sem tocar o banco): quem já está
// autenticado não deve ver as telas de /login ou /cadastro de novo.
// Isso é a linha de frente — a checagem definitiva continua em
// requireGuest() (src/lib/session.ts), que roda no Server Component.
const GUEST_ONLY_ROUTES = new Set(["/login", "/cadastro"]);

export default auth((req) => {
  const { nextUrl, auth: session } = req;

  if (session?.user && GUEST_ONLY_ROUTES.has(nextUrl.pathname)) {
    const dest = session.user.role === "SUPERADMIN" ? "/admin/contas" : "/inicio";
    return NextResponse.redirect(new URL(dest, nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/login", "/cadastro"],
};
