"use client";

import * as React from "react";
import { Button, type ButtonProps } from "./button";
import { cn } from "@/lib/utils";

export type ConfirmCopy = {
  title: string;
  /** O que exatamente vai acontecer, em texto claro. Nada de "tem certeza?". */
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
};

/**
 * Confirmação antes de ação destrutiva (suspender conta, apagar documento,
 * trocar plano de um cliente). Antes essas ações disparavam no primeiro clique.
 *
 * Usa o `<dialog>` nativo com `showModal()`: foco preso no diálogo, Esc para
 * fechar, `inert` no resto da página e devolução do foco ao gatilho — tudo do
 * navegador, sem lib de modal nem armadilha de foco escrita à mão.
 */
export function ConfirmButton({
  confirm,
  onConfirm,
  children,
  className,
  variant = "destructive",
  size,
  disabled,
  ...trigger
}: Omit<ButtonProps, "onClick" | "loading"> & {
  confirm: ConfirmCopy;
  onConfirm: () => void | Promise<void>;
}) {
  const ref = React.useRef<HTMLDialogElement>(null);
  const [pending, setPending] = React.useState(false);

  async function handleConfirm() {
    setPending(true);
    try {
      await onConfirm();
      ref.current?.close();
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        disabled={disabled}
        className={className}
        onClick={() => ref.current?.showModal()}
        {...trigger}
      >
        {children}
      </Button>

      <dialog
        ref={ref}
        aria-labelledby="confirm-title"
        // `m-auto` porque o reset do Tailwind zera as margens automáticas que
        // centralizariam o dialog nativo.
        className={cn(
          "m-auto w-[calc(100%-2rem)] max-w-md rounded-surface border p-6 backdrop:bg-ink/70",
          "border-ink/10 bg-white text-ink",
          "panel:border-white/15 panel:bg-ink panel:text-white",
        )}
        onClose={() => setPending(false)}
      >
        <h2 id="confirm-title" className="font-display text-lg font-semibold">
          {confirm.title}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-neutral panel:text-white/65">
          {confirm.description}
        </p>

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => ref.current?.close()}
            disabled={pending}
          >
            {confirm.cancelLabel ?? "Cancelar"}
          </Button>
          <Button
            type="button"
            variant={confirm.tone === "danger" ? "destructiveSolid" : "default"}
            onClick={handleConfirm}
            loading={pending}
            loadingLabel="Confirmando"
            autoFocus
          >
            {confirm.confirmLabel}
          </Button>
        </div>
      </dialog>
    </>
  );
}
