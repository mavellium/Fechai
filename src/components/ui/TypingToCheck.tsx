"use client";

import { useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * Assinatura da marca: "digitando → check".
 * - state="typing"  → 3 pontos pulsando (indicador de carregando de todo o produto)
 * - state="done"    → check coral (signal) — a conversa/ação foi concluída
 * Usar no lugar de qualquer spinner genérico (ver skill fechai-design-system, seção 6).
 * Respeita prefers-reduced-motion (pontos ficam estáticos).
 */
export function TypingToCheck({
  state,
  size = 20,
  className,
  doneColor = "signal",
}: {
  state: "typing" | "done";
  size?: number;
  className?: string;
  doneColor?: "signal" | "success" | "white";
}) {
  const reduced = useReducedMotion();
  const dot = Math.max(3, Math.round(size / 5));

  if (state === "done") {
    const color =
      doneColor === "white" ? "text-white" : doneColor === "success" ? "text-success" : "text-signal";
    return (
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        className={cn(color, "ttc-pop", className)}
        aria-label="Concluído"
        role="img"
      >
        <path
          d="M4 12.5 9.5 18 20 6.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="ttc-draw"
        />
      </svg>
    );
  }

  return (
    <span
      className={cn("inline-flex items-center", className)}
      style={{ gap: dot * 0.8 }}
      role="status"
      aria-label="Digitando"
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={cn("rounded-full bg-current", !reduced && "ttc-dot")}
          style={{
            width: dot,
            height: dot,
            animationDelay: reduced ? undefined : `${i * 0.18}s`,
            opacity: reduced ? 0.6 : undefined,
          }}
        />
      ))}
    </span>
  );
}
