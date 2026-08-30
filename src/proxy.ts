import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  REFERRAL_COOKIE,
  REFERRAL_COOKIE_DAYS,
  REFERRAL_PARAM,
  REFERRAL_PLAN_PARAM,
} from "@/modules/affiliates/config";

// Checagem otimista (via cookie de sessão, sem tocar o banco): quem já está
// autenticado não deve ver as telas de /login ou /cadastro de novo.
// Isso é a linha de frente — a checagem definitiva continua em
// requireGuest() (src/lib/session.ts), que roda no Server Component.
const GUEST_ONLY_ROUTES = new Set(["/login", "/cadastro"]);

/**
 * Grava o código do afiliado num cookie quando a URL traz `?ref=`.
 *
 * Fica aqui, e não numa página, porque o afiliado divulga o link para
 * QUALQUER rota pública (home, /planos, /afiliados) — capturar no proxy cobre
 * todas de uma vez. A atribuição de verdade acontece no cadastro
 * (attachReferralToTenant); o cookie é só o carregador até lá.
 *
 * O clique não é registrado aqui de propósito: o proxy roda também em
 * prefetch e em recarregamentos, o que inflaria a métrica. Quem registra é a
 * rota /api/afiliados/clique, chamada uma vez pela página que recebeu o ref.
 */
function captureReferral(req: Parameters<Parameters<typeof auth>[0]>[0], res: NextResponse) {
  const code = req.nextUrl.searchParams.get(REFERRAL_PARAM);
  if (!code) return res;

  // Primeiro clique vence: se já existe um cookie, ele é mantido — o crédito
  // é first-touch, e sobrescrever aqui deixaria o último link roubar a venda.
  if (req.cookies.get(REFERRAL_COOKIE)) return res;

  res.cookies.set({
    name: REFERRAL_COOKIE,
    value: code.slice(0, 32),
    maxAge: REFERRAL_COOKIE_DAYS * 24 * 60 * 60,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });

  const plan = req.nextUrl.searchParams.get(REFERRAL_PLAN_PARAM);
  if (plan) {
    res.cookies.set({
      name: `${REFERRAL_COOKIE}_plano`,
      value: plan.slice(0, 16),
      maxAge: REFERRAL_COOKIE_DAYS * 24 * 60 * 60,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
  }

  return res;
}

export default auth((req) => {
  const { nextUrl, auth: session } = req;

  if (session?.user && GUEST_ONLY_ROUTES.has(nextUrl.pathname)) {
    const dest = session.user.role === "SUPERADMIN" ? "/admin/contas" : "/inicio";
    return captureReferral(req, NextResponse.redirect(new URL(dest, nextUrl)));
  }

  return captureReferral(req, NextResponse.next());
});

export const config = {
  // Além das telas de convidado, o matcher cobre as rotas públicas onde um
  // link de afiliado pode cair (home, planos, landing do programa).
  matcher: ["/", "/login", "/cadastro", "/planos", "/afiliados"],
};
