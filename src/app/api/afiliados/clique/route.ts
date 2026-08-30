import { NextResponse } from "next/server";
import { z } from "zod";
import { trackClick } from "@/modules/affiliates/service";
import { isValidPlan } from "@/modules/billing/service";

/**
 * Registra um clique num link de afiliado.
 *
 * Rota própria (e não o proxy) porque o proxy roda em prefetch e em qualquer
 * recarregamento, o que inflaria a métrica. Aqui quem chama é a página que
 * recebeu o `?ref=`, uma vez por visita.
 *
 * Sem autenticação de propósito: o visitante ainda não tem conta. O dado é de
 * topo de funil e não expõe nada — o pior caso de um POST forjado é um número
 * de cliques inflado no painel do próprio afiliado.
 */
const schema = z.object({
  code: z.string().trim().min(1).max(32),
  landingPath: z.string().max(200).optional(),
  planKeyHint: z.string().max(16).optional(),
  utmSource: z.string().max(60).optional(),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  // Silencioso: é telemetria, não uma ação do usuário. Devolver erro só daria
  // ao cliente um motivo para tentar de novo e duplicar o clique.
  if (!parsed.success) return NextResponse.json({ ok: true });

  const { code, landingPath, planKeyHint, utmSource } = parsed.data;
  const plan = planKeyHint?.toUpperCase();

  await trackClick({
    code,
    landingPath,
    planKeyHint: plan && isValidPlan(plan) ? plan : null,
    utmSource,
  });

  return NextResponse.json({ ok: true });
}
