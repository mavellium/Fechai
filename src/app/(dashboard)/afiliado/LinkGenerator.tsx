"use client";

import { useState, useSyncExternalStore } from "react";
import { Link2 } from "lucide-react";
import { PLANS } from "@/modules/billing/plans";
import { commissionOf, bpsToPercentLabel } from "@/modules/affiliates/config";
import { formatBRL } from "@/lib/format";
import { Card, CardTitle } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { cn } from "@/lib/utils";

/** A origem nunca muda enquanto a página vive — nada a assinar. */
function subscribeNoop() {
  return () => {};
}

/**
 * Gerador de links do afiliado — um por plano, mais o link geral.
 *
 * A URL é montada no cliente a partir de `origin` para o link copiado ser
 * sempre o domínio de onde a pessoa está (dev, staging, produção), sem
 * depender de env var no browser. `siteUrl` vem do servidor como fallback
 * para o primeiro render (SSR não tem `window`).
 */
export function LinkGenerator({
  code,
  siteUrl,
  commissionBps,
}: {
  code: string;
  siteUrl: string;
  commissionBps: number;
}) {
  const [copyError, setCopyError] = useState<string | null>(null);

  // `useSyncExternalStore` é o jeito suportado de ler algo que só existe no
  // browser sem descompasso de hidratação: o servidor usa `siteUrl`, o cliente
  // troca pelo `origin` real logo depois. (Mesmo padrão da Sidebar.)
  const origin = useSyncExternalStore(
    subscribeNoop,
    () => window.location.origin,
    () => siteUrl,
  );

  const geral = `${origin}/?ref=${code}`;

  return (
    <Card>
      <CardTitle>Seus links de divulgação</CardTitle>
      <p className="mt-2 text-sm leading-relaxed text-neutral panel:text-white/60">
        Cada link marca a indicação por {" "}
        <strong className="font-medium text-ink panel:text-white/85">30 dias</strong>: se a pessoa
        clicar hoje e assinar em duas semanas, a comissão é sua.
      </p>

      <div className="mt-6 space-y-3">
        <LinkRow
          titulo="Link geral"
          descricao="Leva para a página inicial. Use quando não souber qual plano a pessoa precisa."
          url={geral}
          onCopyError={setCopyError}
          destaque
        />

        {PLANS.filter((p) => p.priceCents > 0).map((plan) => {
          const url = `${origin}/planos?ref=${code}&plano=${plan.key}`;
          const ganho = commissionOf(plan.priceCents, commissionBps);
          return (
            <LinkRow
              key={plan.key}
              titulo={`Plano ${plan.name}`}
              descricao={`${plan.priceLabel}/mês · você recebe ${formatBRL(ganho)} por mês`}
              url={url}
              onCopyError={setCopyError}
            />
          );
        })}
      </div>

      {copyError && (
        <p role="alert" className="mt-4 text-sm text-warn">
          {copyError}
        </p>
      )}

      <p className="mt-6 border-t border-ink/10 pt-4 text-xs leading-relaxed text-neutral panel:border-white/10 panel:text-white/50">
        Comissão de {bpsToPercentLabel(commissionBps)} sobre cada mensalidade paga, enquanto o
        cliente indicado mantiver a assinatura.
      </p>
    </Card>
  );
}

function LinkRow({
  titulo,
  descricao,
  url,
  destaque,
  onCopyError,
}: {
  titulo: string;
  descricao: string;
  url: string;
  destaque?: boolean;
  onCopyError: (msg: string) => void;
}) {
  return (
    <div
      className={cn(
        "rounded-control border p-4",
        destaque
          ? "border-iris/40 bg-iris/5 panel:border-iris/40 panel:bg-iris/10"
          : "border-ink/10 panel:border-white/10",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-display text-sm font-semibold text-ink panel:text-white">
            <Link2 size={14} className="text-iris" aria-hidden />
            {titulo}
          </p>
          <p className="mt-1 text-xs text-neutral panel:text-white/55">{descricao}</p>
        </div>
        <CopyButton value={url} onCopyError={onCopyError} />
      </div>

      {/* O link fica visível e selecionável: nem todo mundo confia num botão
          "copiar" sem ver o que foi copiado. */}
      <p className="mt-3 overflow-x-auto whitespace-nowrap rounded-sm bg-ink/5 px-3 py-2 font-mono text-xs text-ink/70 panel:bg-white/5 panel:text-white/60">
        {url}
      </p>
    </div>
  );
}
