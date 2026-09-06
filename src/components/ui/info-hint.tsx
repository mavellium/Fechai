"use client";

import * as React from "react";
import { HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Explicação secundária que sai da tela e volta sob demanda: a "bolinha de
 * dúvida" ao lado de um título.
 *
 * Existia como parágrafo fixo abaixo de cada título de card e gráfico. Somados,
 * eram dezenas de linhas de texto cinza competindo com os números que a pessoa
 * veio ver. O texto continua ali — só deixou de gritar.
 *
 * **Só para texto explicativo** (o que este cartão mede, de onde vem o número).
 * Dica de preenchimento de campo — unidade, formato, exemplo — continua visível
 * no `<Field hint>`: quem está digitando precisa dela antes de digitar, e um
 * texto que exige passar o mouse não existe para quem usa toque. Status que
 * muda com o estado também fica visível (`hintInline` no `CardTitle`).
 *
 * Acessibilidade: é um `<button>` de verdade, alcançável por teclado, e abre no
 * clique além do hover — hover sozinho não alcança toque nem teclado. Esc e
 * clique fora fecham. O conteúdo só entra na árvore de acessibilidade quando
 * aberto: `aria-describedby` permanente faria o leitor de tela recitar o
 * parágrafo inteiro a cada foco, que é o oposto de tirar ruído do caminho.
 */
export function InfoHint({
  label,
  children,
  className,
}: {
  /** Do que é esta explicação — entra no rótulo acessível ("Sobre {label}"). */
  label: string;
  /** O texto da explicação. */
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  // Alinha à direita quando o botão está perto da borda da janela, senão o
  // balão de 16rem vaza para fora da tela (títulos no fim de uma grade).
  const [alignEnd, setAlignEnd] = React.useState(false);
  const uid = React.useId();
  const tipId = `hint-${uid}`;
  const wrapRef = React.useRef<HTMLSpanElement>(null);

  const show = React.useCallback(() => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (rect) setAlignEnd(rect.left + 272 > window.innerWidth);
    setOpen(true);
  }, []);

  // Esc fecha e clique fora fecha — um balão aberto não pode ficar preso na
  // tela depois que a pessoa seguiu em frente.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  return (
    <span
      ref={wrapRef}
      className={cn("relative inline-flex align-middle", className)}
      onMouseEnter={show}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={`Sobre ${label}`}
        aria-expanded={open}
        aria-describedby={open ? tipId : undefined}
        onClick={() => (open ? setOpen(false) : show())}
        onFocus={show}
        onBlur={() => setOpen(false)}
        className={cn(
          "rounded-full p-0.5 text-neutral/70 transition-colors",
          "hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris",
          "panel:text-white/45 panel:hover:text-white",
        )}
      >
        <HelpCircle size={14} aria-hidden />
      </button>

      {open && (
        <span
          id={tipId}
          role="tooltip"
          className={cn(
            "pointer-events-none absolute top-full z-50 mt-2 w-64 rounded-surface px-3 py-2",
            // O balão pode nascer dentro de um título: reseta a tipografia
            // herdada (versalete, tracking largo, peso do display).
            "font-sans text-sm font-normal normal-case leading-relaxed tracking-normal",
            "border border-ink/10 bg-white text-neutral shadow-lg",
            "panel:border-white/15 panel:bg-ink panel:text-white/75",
            alignEnd ? "right-0" : "left-0",
          )}
        >
          {children}
        </span>
      )}
    </span>
  );
}
