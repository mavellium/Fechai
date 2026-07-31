"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Container rolável de mensagens, com rolagem automática para o fim.
 *
 * As duas telas de conversa tinham o mesmo defeito: mensagem nova entrava
 * abaixo da área visível e o usuário não via a resposta sem rolar à mão. Aqui
 * a rolagem acompanha `scrollKey` (quantidade de mensagens, id da conversa…).
 *
 * `role="log"` + `aria-live="polite"`: leitor de tela anuncia a resposta que
 * chega sem roubar o foco de quem está digitando.
 */
export function ChatLog({
  children,
  className,
  label,
  scrollKey,
}: {
  children: React.ReactNode;
  className?: string;
  label: string;
  /** Muda quando há conteúdo novo — dispara a rolagem. */
  scrollKey: string | number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // `auto` e não `smooth`: aqui a rolagem é reposicionamento, não animação —
    // e animar atrasaria a leitura da mensagem que acabou de chegar.
    el.scrollTop = el.scrollHeight;
  }, [scrollKey]);

  return (
    <div
      ref={ref}
      role="log"
      aria-live="polite"
      aria-label={label}
      tabIndex={0}
      className={cn(
        "space-y-2 overflow-y-auto overscroll-contain",
        // rolável por teclado precisa de foco visível
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris",
        className,
      )}
    >
      {children}
    </div>
  );
}
