import * as React from "react";
import { cn } from "@/lib/utils";
import { InfoHint } from "./info-hint";

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

/**
 * Título de card. O `hint` explica o que o card mostra — e por padrão vive
 * numa bolinha de dúvida ao lado do título, não num parágrafo abaixo dele.
 *
 * A regra vale porque esse texto é de consulta: quem já sabe o que é o card
 * (a maioria, na segunda visita) só precisa dele fora do caminho. Onde a
 * explicação for necessária ANTES de agir — instrução, não descrição — use
 * `hintInline` e ela continua visível.
 */
export function CardTitle({
  children,
  hint,
  hintInline,
  hintLabel,
  action,
  as: Heading = "h2",
}: {
  children: React.ReactNode;
  hint?: React.ReactNode;
  /** Rótulo acessível da bolinha quando o título não é texto puro. */
  hintLabel?: string;
  /** Mantém o `hint` como parágrafo visível (instrução, não descrição). */
  hintInline?: boolean;
  /** Ação no canto direito do título (ex.: contador, botão secundário). */
  action?: React.ReactNode;
  /** Ajuste quando o card não estiver logo abaixo do `h1` da página. */
  as?: "h2" | "h3";
}) {
  // O rótulo acessível da bolinha é o próprio título, quando ele é texto puro;
  // com título composto (ícone + texto), quem chama informa via `hintLabel`.
  const label = hintLabel ?? (typeof children === "string" ? children : "este cartão");

  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <Heading className="font-display flex items-center gap-1.5 text-lg font-semibold text-ink panel:text-white">
          {children}
          {hint && !hintInline && <InfoHint label={label}>{hint}</InfoHint>}
        </Heading>
        {hint && hintInline && (
          <p className="mt-1 max-w-prose text-sm text-neutral panel:text-white/55">{hint}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
