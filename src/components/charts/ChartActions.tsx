"use client";

import * as React from "react";
import { Info, Maximize2, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * As duas ações que todo gráfico do dashboard oferece, num componente só:
 *
 * 1. **Ampliar** — abre o gráfico em tela cheia, com a tabela de todos os
 *    pontos e os totais (`full`).
 * 2. **Como é calculado** — abre a origem dos dados: o que exatamente entra
 *    no número e o que é excluído (`description` + `sources`).
 *
 * `<dialog>` nativo com `showModal()` (mesma técnica do ConfirmButton): foco
 * preso, Esc fecha, `inert` no resto da página. Quem usa o componente decide
 * onde colocar os botões — no `action` do `CardTitle`, num cabeçalho do
 * próprio gráfico etc.
 */
export function ChartActions({
  label,
  title,
  hint,
  description,
  sources,
  full,
}: {
  /** Nome do gráfico — entra nos rótulos acessíveis dos botões. */
  label: string;
  /** Título dentro dos diálogos. */
  title: string;
  /** Sub-título do diálogo de tela cheia. */
  hint: string;
  /** Parágrafo do "Como este resultado é calculado". */
  description: string;
  /** Linhas do resumo do "Origem dos dados": [rótulo, valor]. */
  sources: [string, string][];
  /** Conteúdo ampliado (gráfico maior + tabela) no diálogo de tela cheia. */
  full: React.ReactNode;
}) {
  const fullRef = React.useRef<HTMLDialogElement>(null);
  const infoRef = React.useRef<HTMLDialogElement>(null);
  const uid = React.useId();
  const fullId = `dialog-${uid}`;
  const infoId = `info-${uid}`;

  const iconBtn =
    "shrink-0 rounded-control p-1.5 text-neutral transition-colors " +
    "hover:bg-ink/5 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris " +
    "panel:text-white/60 panel:hover:bg-white/10 panel:hover:text-white";

  const dialogBase =
    "m-auto w-[calc(100%-2rem)] max-w-3xl rounded-surface border p-6 backdrop:bg-ink/70 " +
    "border-ink/10 bg-white text-ink panel:border-white/15 panel:bg-ink panel:text-white";

  return (
    <>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => fullRef.current?.showModal()}
          aria-label={`Ampliar ${label}`}
          title="Abrir em tela cheia"
          className={iconBtn}
        >
          <Maximize2 size={15} aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => infoRef.current?.showModal()}
          aria-label={`Como ${label} é calculado`}
          title="Origem dos dados"
          className={iconBtn}
        >
          <Info size={15} aria-hidden />
        </button>
      </div>

      <dialog ref={fullRef} aria-labelledby={fullId} className={dialogBase}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id={fullId} className="font-display text-lg font-semibold">
              {title}
            </h2>
            <p className="mt-1 text-sm text-neutral panel:text-white/55">{hint}</p>
          </div>
          <button type="button" onClick={() => fullRef.current?.close()} aria-label="Fechar" className={iconBtn}>
            <X size={18} aria-hidden />
          </button>
        </div>
        {full}
      </dialog>

      <dialog ref={infoRef} aria-labelledby={infoId} className={cn(dialogBase, "max-w-md")}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id={infoId} className="font-display text-lg font-semibold">
              {title}
            </h2>
            <p className="mt-1 text-sm text-neutral panel:text-white/55">Como este resultado é calculado</p>
          </div>
          <button type="button" onClick={() => infoRef.current?.close()} aria-label="Fechar" className={iconBtn}>
            <X size={18} aria-hidden />
          </button>
        </div>
        <p className="text-sm leading-relaxed text-neutral panel:text-white/65">{description}</p>
        <dl className="mt-4 space-y-2">
          {sources.map(([name, value]) => (
            <div
              key={name}
              className="flex items-baseline justify-between gap-4 rounded-control bg-ink/5 px-3 py-2 text-sm panel:bg-white/5"
            >
              <dt className="text-neutral panel:text-white/60">{name}</dt>
              <dd className="text-right font-mono text-xs tabular-nums text-ink panel:text-white">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </dialog>
    </>
  );
}
