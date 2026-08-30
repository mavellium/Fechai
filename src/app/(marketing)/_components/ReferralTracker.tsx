"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { REFERRAL_PARAM, REFERRAL_PLAN_PARAM } from "@/modules/affiliates/config";

/**
 * Dispara o registro do clique quando a URL traz `?ref=`.
 *
 * O cookie de atribuição quem grava é o proxy (roda antes da página, inclusive
 * sem JS). Este componente só cuida da MÉTRICA — por isso pode viver no
 * cliente e falhar em silêncio: um clique não contado não custa comissão a
 * ninguém, mas uma exceção aqui quebraria a landing.
 *
 * `sessionStorage` evita contar de novo a cada navegação interna ou F5 dentro
 * da mesma sessão do navegador.
 */
export function ReferralTracker() {
  const params = useSearchParams();
  const pathname = usePathname();

  useEffect(() => {
    const code = params.get(REFERRAL_PARAM);
    if (!code) return;

    const key = `fechai:ref-click:${code}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      // Navegador sem storage (aba privada restrita): segue e registra —
      // contar duas vezes é melhor que não contar.
    }

    void fetch("/api/afiliados/clique", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        landingPath: pathname,
        planKeyHint: params.get(REFERRAL_PLAN_PARAM) ?? undefined,
        utmSource: params.get("utm_source") ?? undefined,
      }),
    }).catch(() => {});
  }, [params, pathname]);

  return null;
}
