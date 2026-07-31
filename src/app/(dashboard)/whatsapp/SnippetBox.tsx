"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { CopyButton } from "@/components/ui/copy-button";

/**
 * Snippet do widget com botão de copiar. Antes era um `<pre>` puro: o usuário
 * tinha que selecionar o texto no meio de uma barra de rolagem horizontal.
 */
export function SnippetBox({ tenantId }: { tenantId: string }) {
  const [error, setError] = useState<string | null>(null);
  const snippet = `<script src="https://seu-dominio/widget.js" data-tenant="${tenantId}"></script>`;

  return (
    <div className="space-y-3">
      <pre className="overflow-x-auto rounded-control border border-white/10 bg-black/40 p-4 font-mono text-xs text-white/80">
        {snippet}
      </pre>
      <div className="flex flex-wrap items-center gap-3">
        <CopyButton value={snippet} label="Copiar código" onCopyError={setError} />
        <span className="text-xs text-white/60">
          Não sabe onde colar? Copie e envie para quem cuida do seu site — é só colar antes do
          final da página.
        </span>
      </div>
      {error && <Alert tone="warn">{error}</Alert>}
    </div>
  );
}
