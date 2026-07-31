"use client";

import { cn } from "@/lib/utils";
import { LoadingDots } from "./loading-dots";

export type Segment<T extends string> = { value: T; label: string };

/**
 * Escolha única entre poucas opções, com commit no clique.
 *
 * Existe para substituir os `<select onChange={salvar}>` de commit implícito:
 * navegando um select fechado pelo teclado, o navegador dispara `change` em
 * cada opção percorrida — ou seja, gravava um estado intermediário no banco a
 * cada seta. Aqui cada opção é um botão: uma intenção, uma gravação.
 */
export function SegmentedControl<T extends string>({
  value,
  options,
  onSelect,
  label,
  loading,
  disabled,
  className,
}: {
  value: T;
  options: Segment<T>[];
  onSelect: (next: T) => void;
  /** Nome do grupo para leitores de tela. */
  label: string;
  loading?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full p-1",
        "bg-ink/5 panel:bg-white/10",
        className,
      )}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled || loading}
            onClick={() => !on && onSelect(o.value)}
            className={cn(
              "rounded-full px-3 py-1 font-mono text-micro uppercase tracking-wide transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris focus-visible:ring-offset-2",
              "focus-visible:ring-offset-paper panel:focus-visible:ring-offset-ink",
              "disabled:cursor-not-allowed disabled:opacity-60",
              on
                ? "bg-iris text-white"
                : "text-neutral enabled:hover:text-ink panel:text-white/60 panel:enabled:hover:text-white",
            )}
          >
            {on && loading ? <LoadingDots size={3} label={null} /> : o.label}
          </button>
        );
      })}
    </div>
  );
}
