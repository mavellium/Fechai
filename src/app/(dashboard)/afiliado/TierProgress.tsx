import { Trophy } from "lucide-react";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { COMMISSION_TIERS, bpsToPercentLabel } from "@/modules/affiliates/config";
import type { AffiliateOverview } from "@/modules/affiliates/stats";
import { cn } from "@/lib/utils";

/**
 * Escada de níveis do afiliado.
 *
 * O objetivo da tela é uma frase: "faltam N vendas para você ganhar X%". Por
 * isso a meta aparece antes da lista — a lista é referência, a meta é o que
 * move. Quem já está no topo vê a confirmação, não um alvo vazio.
 *
 * As faixas vêm de `COMMISSION_TIERS` em ordem decrescente; aqui são exibidas
 * do menor para o maior, que é como se lê uma escada.
 */
export function TierProgress({ tier }: { tier: AffiliateOverview["tier"] }) {
  const { current, activeSales, next, overridden } = tier;
  const escada = [...COMMISSION_TIERS].reverse();

  // Progresso dentro da faixa atual: de onde ela começa até onde a próxima
  // começa. No topo, a barra fica cheia.
  const progresso = next
    ? Math.min(
        100,
        Math.round(
          ((activeSales - current.minSales) / (next.tier.minSales - current.minSales)) * 100,
        ),
      )
    : 100;

  return (
    <Card>
      <CardTitle
        hint={
          overridden
            ? "Sua conta tem um percentual combinado à parte, fixo independente do volume."
            : "Quanto mais assinantes ativos, maior sua comissão em todas as vendas."
        }
        action={
          <Badge tone="iris" icon={<Trophy size={12} />}>
            {overridden ? "Personalizado" : current.label}
          </Badge>
        }
      >
        Seu nível
      </CardTitle>

      {overridden ? (
        <p className="text-sm leading-relaxed text-neutral panel:text-white/60">
          O programa de níveis não se aplica à sua conta: seu percentual foi definido
          individualmente e não muda com o volume de vendas.
        </p>
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-4">
            <p className="font-display text-4xl font-bold tabular-nums text-ink panel:text-white">
              {bpsToPercentLabel(current.bps)}
            </p>
            <p className="text-right text-sm text-neutral panel:text-white/60">
              {activeSales} {activeSales === 1 ? "venda ativa" : "vendas ativas"}
            </p>
          </div>

          {next ? (
            <>
              <div
                className="mt-4 h-2 overflow-hidden rounded-full bg-ink/10 panel:bg-white/10"
                role="progressbar"
                aria-valuenow={progresso}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Progresso para o nível ${next.tier.label}`}
              >
                <div
                  className="h-full rounded-full bg-signal transition-[width] duration-500 motion-reduce:transition-none"
                  style={{ width: `${progresso}%` }}
                />
              </div>
              <p className="mt-3 text-sm leading-relaxed text-neutral panel:text-white/60">
                Faltam{" "}
                <strong className="font-semibold text-ink panel:text-white">
                  {next.salesToGo} {next.salesToGo === 1 ? "venda" : "vendas"}
                </strong>{" "}
                para você subir para {next.tier.label} e ganhar{" "}
                <strong className="font-semibold text-signal">
                  {bpsToPercentLabel(next.tier.bps)}
                </strong>{" "}
                em <em>todas</em> as suas assinaturas.
              </p>
            </>
          ) : (
            <p className="mt-4 text-sm leading-relaxed text-neutral panel:text-white/60">
              Você está no nível máximo do programa. Toda mensalidade das suas indicações paga{" "}
              <strong className="font-semibold text-signal">
                {bpsToPercentLabel(current.bps)}
              </strong>
              .
            </p>
          )}
        </>
      )}

      <ol className="mt-6 space-y-1 border-t border-ink/10 pt-4 panel:border-white/10">
        {escada.map((t) => {
          const alcancado = activeSales >= t.minSales;
          const atual = !overridden && t.minSales === current.minSales;
          return (
            <li
              key={t.minSales}
              aria-current={atual ? "true" : undefined}
              className={cn(
                "flex items-center justify-between gap-3 rounded-control px-3 py-2 text-sm",
                atual && "bg-iris/8 panel:bg-iris/15",
              )}
            >
              <span
                className={cn(
                  "flex items-center gap-2",
                  alcancado && !overridden
                    ? "text-ink panel:text-white"
                    : "text-neutral panel:text-white/50",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    atual
                      ? "bg-signal"
                      : alcancado && !overridden
                        ? "bg-success"
                        : "bg-ink/20 panel:bg-white/25",
                  )}
                />
                {t.label}
                <span className="text-neutral panel:text-white/45">
                  {t.minSales === 0 ? "· a partir da 1ª venda" : `· ${t.minSales}+ vendas`}
                </span>
              </span>
              <span
                className={cn(
                  "font-mono tabular-nums",
                  atual
                    ? "font-semibold text-signal"
                    : alcancado && !overridden
                      ? "text-ink panel:text-white"
                      : "text-neutral panel:text-white/50",
                )}
              >
                {bpsToPercentLabel(t.bps)}
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
