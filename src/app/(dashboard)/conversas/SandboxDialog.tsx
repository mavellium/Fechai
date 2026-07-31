"use client";

import { useRef } from "react";
import { X, FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sandbox } from "./Sandbox";

/**
 * O sandbox saiu do fluxo da página e virou um diálogo acionado pelo cabeçalho.
 *
 * Ele ocupava um card permanente numa tela cujo assunto são conversas reais, e
 * empurrava a lista para cima do dobra. Aqui continua a um clique de distância,
 * sem disputar espaço com o que a pessoa veio ver.
 *
 * `<dialog>` nativo com `showModal()`, como o `ConfirmButton` e o `MobileNav`:
 * foco preso, `Esc`, `inert` no resto da página e devolução do foco ao gatilho.
 */
export function SandboxDialog({ label = "Testar agente" }: { label?: string }) {
  const ref = useRef<HTMLDialogElement>(null);

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => ref.current?.showModal()}>
        <FlaskConical size={14} aria-hidden />
        {label}
      </Button>

      <dialog
        ref={ref}
        aria-labelledby="sandbox-title"
        // `m-auto`: o reset do Tailwind zera as margens automáticas que
        // centralizariam o dialog nativo.
        className="m-auto w-[calc(100%-2rem)] max-w-xl rounded-surface border border-white/15 bg-ink p-6 text-white backdrop:bg-ink/70"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id="sandbox-title" className="font-display text-lg font-semibold">
              Testar seu agente
            </h2>
            <p className="mt-1 text-sm text-white/55">
              Converse como um cliente conversaria, sem precisar do WhatsApp. O teste fica salvo
              na lista como o contato “Sandbox”.
            </p>
          </div>
          <button
            type="button"
            onClick={() => ref.current?.close()}
            aria-label="Fechar teste"
            className="shrink-0 rounded-control p-1 text-white/60 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        <Sandbox />
      </dialog>
    </>
  );
}
