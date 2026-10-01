"use client";

import { Download } from "lucide-react";

/** Controles fora do documento aprovado; não entram na impressão do servidor. */
export function PrintToolbar() {
  return <div className="mx-auto flex max-w-[860px] flex-wrap items-center justify-between gap-3 border-b border-ink/15 bg-paper p-4 text-ink print:hidden" data-print-toolbar>
    <p className="max-w-prose text-sm text-neutral">Para exportar, clique em Salvar em PDF e escolha “Salvar como PDF” no destino da impressão.</p>
    <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-control bg-iris px-4 py-2 text-sm font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-iris focus-visible:ring-offset-2"><Download size={16} aria-hidden />Salvar em PDF</button>
  </div>;
}
