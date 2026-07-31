import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Superfície de conteúdo. Borda sutil OU sombra — nunca as duas (skill
 * design-ui, §5). Raio vem do token `rounded-surface` — nunca valor solto.
 *
 * Adapta-se à superfície: branca no fundo `paper`, translúcida no painel escuro.
 */
export function Card({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn(
        "rounded-surface border border-ink/10 bg-white p-6 panel:border-white/10 panel:bg-white/5",
        className,
      )}
      {...props}
    >
      {children}
    </section>
  );
}

export function CardTitle({
  children,
  hint,
  action,
  as: Heading = "h2",
}: {
  children: React.ReactNode;
  hint?: string;
  /** Ação no canto direito do título (ex.: contador, botão secundário). */
  action?: React.ReactNode;
  /** Ajuste quando o card não estiver logo abaixo do `h1` da página. */
  as?: "h2" | "h3";
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <Heading className="font-display text-lg font-semibold text-ink panel:text-white">
          {children}
        </Heading>
        {hint && <p className="mt-1 text-sm text-neutral panel:text-white/55">{hint}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
