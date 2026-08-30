import { Check } from "lucide-react";
import { PLANS } from "@/modules/billing/plans";
import {
  bpsToPercentLabel,
  COMMISSION_TIERS,
  commissionOf,
} from "@/modules/affiliates/config";
import { formatBRL } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * A escada de comissão.
 *
 * O argumento não é "temos níveis" (isso é estrutura), é "a mesma carteira
 * passa a valer mais" — por isso cada faixa mostra quanto rendem 10 assinaturas
 * do plano Pro naquele percentual. O mesmo esforço, números diferentes: é o
 * que faz a progressão parecer um ganho, não uma trava.
 *
 * As faixas saem de `COMMISSION_TIERS` (ordem decrescente) e são exibidas do
 * menor para o maior, como se lê uma escada.
 */
export function Niveis() {
  const plano = PLANS.find((p) => p.highlight) ?? PLANS[1];
  const escada = [...COMMISSION_TIERS].reverse();

  return (
    <section
      id="niveis"
      className="border-t border-ink/10 bg-white px-4 py-20 md:py-28"
      aria-labelledby="niveis-titulo"
    >
      <div className="mx-auto max-w-6xl">
        <p className="reveal font-mono text-micro uppercase tracking-[0.3em] text-neutral">
          níveis
        </p>
        <h2
          id="niveis-titulo"
          className="reveal font-display mt-5 max-w-2xl text-3xl font-bold leading-[1.08] tracking-tight text-ink sm:text-4xl"
        >
          Quanto mais você vende, mais vale cada venda.
        </h2>
        <p className="reveal mt-4 max-w-prose leading-relaxed text-neutral">
          Ao subir de nível, o novo percentual passa a valer para{" "}
          <strong className="font-semibold text-ink">todas</strong> as suas assinaturas — inclusive
          as antigas. Não é só a próxima venda que melhora: a carteira inteira sobe junto.
        </p>

        <ol className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {escada.map((tier) => {
            const destaque = tier.bps === COMMISSION_TIERS[0].bps;
            const dezAssinaturas = commissionOf(plano.priceCents, tier.bps) * 10;
            return (
              <li
                key={tier.minSales}
                className={cn(
                  "reveal flex flex-col rounded-xl p-6 md:p-7",
                  destaque ? "bg-ink text-white" : "border border-neutral/20 bg-paper",
                )}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <h3
                    className={cn(
                      "font-display text-lg font-semibold",
                      destaque ? "text-white" : "text-ink",
                    )}
                  >
                    {tier.label}
                  </h3>
                  {destaque && (
                    <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-signal">
                      topo
                    </span>
                  )}
                </div>

                <p className="mt-3">
                  <span
                    className={cn(
                      "font-display text-4xl font-bold tabular-nums",
                      destaque ? "text-white" : "text-ink",
                    )}
                  >
                    {bpsToPercentLabel(tier.bps)}
                  </span>
                </p>

                <p
                  className={cn(
                    "mt-2 font-mono text-xs uppercase tracking-[0.15em]",
                    destaque ? "text-white/50" : "text-neutral",
                  )}
                >
                  {tier.minSales === 0
                    ? "da 1ª venda em diante"
                    : `a partir de ${tier.minSales} vendas`}
                </p>

                <div
                  className={cn(
                    "mt-6 flex-1 border-t pt-5 text-sm leading-relaxed",
                    destaque ? "border-white/10 text-white/70" : "border-neutral/20 text-neutral",
                  )}
                >
                  <span className="flex items-start gap-2">
                    <Check
                      size={15}
                      className={cn("mt-0.5 shrink-0", destaque ? "text-signal" : "text-success")}
                      aria-hidden
                    />
                    <span>
                      10 assinaturas {plano.name} rendem{" "}
                      <strong
                        className={cn(
                          "font-semibold tabular-nums",
                          destaque ? "text-white" : "text-ink",
                        )}
                      >
                        {formatBRL(dezAssinaturas)}
                      </strong>{" "}
                      por mês
                    </span>
                  </span>
                </div>
              </li>
            );
          })}
        </ol>

        <p className="reveal mt-8 max-w-prose text-sm leading-relaxed text-neutral">
          O nível considera as assinaturas ativas que você indicou. Se um cliente cancela, ele sai
          da contagem — o que já foi pago a você continua seu.
        </p>
      </div>
    </section>
  );
}
