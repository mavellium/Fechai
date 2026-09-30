"use client";

import { useState, type ReactNode } from "react";
import { Modal } from "@/components/ui/modal";

/**
 * "Ver registros" de um número do ROI mensal. O conteúdo (tabela montada no
 * servidor a partir do snapshot) chega como `children` e só entra no DOM com
 * o diálogo aberto: são até milhares de linhas por indicador.
 */
export function EvidenceDialog({ label, title, description, children }: {
  label: string; title: string; description?: ReactNode; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)}
      className="whitespace-nowrap rounded-sm text-sm text-iris underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-iris">
      {label}
    </button>
    <Modal open={open} onClose={() => setOpen(false)} title={title} description={description} size="full">
      {open ? children : null}
    </Modal>
  </>;
}
