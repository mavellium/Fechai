"use client";

import { useLinkStatus } from "next/link";
import { cn } from "@/lib/utils";

/**
 * Véu sobre o link clicado enquanto a navegação não chega — o dia do
 * calendário acende no clique, em vez de a tela parecer parada até a página
 * nova aparecer.
 *
 * Sempre renderizado e só muda a opacidade (a doc do `useLinkStatus` pede
 * isso): aparecer e sumir deslocaria o conteúdo da casa. O pai precisa ser
 * `relative`.
 */
export function LinkPendingHint() {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 rounded-control bg-iris/20 opacity-0 transition-opacity duration-150",
        pending && "opacity-100 motion-safe:animate-pulse",
      )}
    />
  );
}
