"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Diálogo centrado com overlay, para uma tarefa que merece a tela inteira —
 * criar uma conta, por exemplo.
 *
 * Irmão do `SidePanel`: mesma mecânica de `<dialog>` nativo com `showModal()`
 * (foco preso, Esc, `inert` no resto da página, foco de volta ao gatilho), só
 * que centrado em vez de encostado na lateral. A escolha entre os dois é de
 * conteúdo: painel para editar um item de uma lista sem perder a lista de
 * vista; modal quando a tarefa é o assunto inteiro e a página atrás é só
 * contexto.
 *
 * O `<dialog>` modal é promovido ao top layer do navegador, então nem
 * `overflow` nem `z-index` de ancestral o corta — é o que faz ele funcionar
 * dentro de uma célula de tabela ou de um contêiner rolável.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  size = "default",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  /** `wide` para formulários de duas colunas. */
  size?: "default" | "wide";
}) {
  const ref = React.useRef<HTMLDialogElement>(null);
  const titleId = React.useId();

  // `showModal()` é imperativo: o React controla `open` e este efeito sincroniza
  // o elemento. Chamar `showModal()` num diálogo já aberto lança, daí a checagem.
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      // `close` cobre todos os caminhos de fechamento — Esc, `el.close()` do
      // efeito acima e o botão — e mantém o estado de quem chama em dia. Nada
      // de `onCancel` junto: no Esc o navegador dispara `cancel` e depois
      // `close`, e os dois ligados chamariam `onClose` em dobro.
      onClose={onClose}
      // Clique no overlay fecha. O alvo é o próprio <dialog> (o backdrop é
      // pseudo-elemento dele), nunca o conteúdo — daí a comparação.
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        "m-auto w-[calc(100%-2rem)] rounded-surface border p-0",
        "max-h-[calc(100dvh-4rem)] border-white/12 bg-ink text-white",
        // Overlay: escurece e desfoca o que está atrás, para o diálogo virar o
        // único assunto sem esconder de todo o contexto.
        "backdrop:bg-ink/80 backdrop:backdrop-blur-sm",
        "open:flex open:flex-col",
        size === "wide" ? "max-w-2xl" : "max-w-md",
      )}
    >
      {/* O cabeçalho fica fixo: num formulário longo, o botão de fechar não
          pode sumir junto com a rolagem. */}
      <header className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
        <div className="min-w-0">
          <h2 id={titleId} className="font-display text-lg font-semibold">
            {title}
          </h2>
          {description && <p className="mt-1 text-sm text-white/55">{description}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          className="shrink-0 rounded-control p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
        >
          <X size={18} aria-hidden />
        </button>
      </header>

      {/* `min-h-0`: sem isso o corpo cresce com o conteúdo e estoura a altura
          máxima em vez de rolar dentro dela. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
    </dialog>
  );
}
