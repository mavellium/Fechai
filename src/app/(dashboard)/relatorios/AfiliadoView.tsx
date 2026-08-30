import { HandCoins, TrendingUp, Users, Wallet } from "lucide-react";
import { formatBRL } from "@/lib/format";
import { bpsToPercentLabel } from "@/modules/affiliates/config";
import type { AffiliateOverview } from "@/modules/affiliates/stats";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FadeIn } from "@/components/ui/FadeIn";
import { Stat } from "@/components/ui/stat";
import { EarningsChart } from "./EarningsChart";

/**
 * Aba "Afiliados" dos relatórios: a evolução dos ganhos ao longo dos meses.
 *
 * Complementa — não repete — o painel /afiliado. Lá o afiliado opera (gera
 * link, vê o extrato, configura o Pix); aqui ele olha a série histórica e
 * responde "estou crescendo?".
 */
export function AfiliadoView({ overview }: { overview: AffiliateOverview }) {
  const { earnings, funnel, monthly } = overview;

  const totalNoPeriodo = monthly.reduce((s, m) => s + m.earningsCents, 0);
  const mesAtual = monthly[monthly.length - 1];
  const mesAnterior = monthly[monthly.length - 2];
  const delta =
    mesAnterior && mesAtual ? mesAtual.earningsCents - mesAnterior.earningsCents : undefined;

  // Nunca ganhou nada: a grade de zeros não informa, e o próximo passo é
  // divulgar o link — não ficar olhando o gráfico.
  if (earnings.lifetimeCents === 0 && funnel.signups === 0) {
    return (
      <Card>
        <EmptyState
          icon={HandCoins}
          title="Sua evolução aparece aqui"
          description="Assim que a primeira pessoa assinar pelo seu link, os ganhos mês a mês passam a ser desenhados neste gráfico."
          action={<ButtonLink href="/afiliado">Pegar meu link</ButtonLink>}
        />
      </Card>
    );
  }

  return (
    <>
      <FadeIn>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat
            label="Ganho este mês"
            value={formatBRL(mesAtual?.earningsCents ?? 0)}
            hint={delta === undefined ? undefined : "vs. mês anterior"}
            delta={delta === undefined ? undefined : Math.round(delta / 100)}
          />
          <Stat
            label="Receita recorrente"
            value={formatBRL(earnings.mrrCents)}
            hint="das assinaturas ativas que você indicou"
          />
          <Stat
            label="Assinantes ativos"
            value={String(funnel.active)}
            hint={`${funnel.conversionRate}% dos cadastros indicados`}
          />
          <Stat
            label="Total já ganho"
            value={formatBRL(earnings.lifetimeCents)}
            hint={`nível ${overview.tier.current.label} · ${bpsToPercentLabel(overview.commissionBps)}`}
          />
        </div>
      </FadeIn>

      <FadeIn>
        <Card>
          <CardTitle
            hint={`Comissões geradas em cada mês — ${formatBRL(totalNoPeriodo)} no período.`}
          >
            Evolução dos ganhos
          </CardTitle>
          <EarningsChart points={monthly} />
        </Card>
      </FadeIn>

      <FadeIn>
        <div className="grid gap-6 lg:grid-cols-3">
          <Card>
            <CardTitle as="h3" hint="Do cadastro à assinatura paga.">
              Funil de indicações
            </CardTitle>
            <dl className="space-y-3">
              <Linha icon={Users} label="Cadastros indicados" value={String(funnel.signups)} />
              <Linha icon={TrendingUp} label="Viraram assinantes" value={String(funnel.active)} />
              <Linha icon={Wallet} label="Cancelaram" value={String(funnel.churned)} />
              {overview.tier.next && (
                <div className="flex items-baseline justify-between gap-4 border-t border-ink/10 pt-3 panel:border-white/10">
                  <dt className="text-sm text-neutral panel:text-white/60">
                    Faltam para {overview.tier.next.tier.label}
                  </dt>
                  <dd className="font-mono tabular-nums text-signal">
                    {overview.tier.next.salesToGo}
                  </dd>
                </div>
              )}
            </dl>
          </Card>

          <Card className="lg:col-span-2">
            <CardTitle as="h3" hint="Onde está o seu dinheiro agora.">
              Situação das comissões
            </CardTitle>
            <dl className="space-y-3">
              <Linha
                icon={Wallet}
                label="Disponível para saque"
                value={formatBRL(earnings.approvedCents)}
              />
              <Linha
                icon={HandCoins}
                label="Em análise (janela de 30 dias)"
                value={formatBRL(earnings.pendingCents)}
              />
              <Linha icon={TrendingUp} label="Já pago" value={formatBRL(earnings.paidCents)} />
            </dl>
          </Card>
        </div>
      </FadeIn>
    </>
  );
}

function Linha({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Users;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-ink/5 pb-3 last:border-0 last:pb-0 panel:border-white/5">
      <dt className="flex items-center gap-2 text-sm text-neutral panel:text-white/60">
        <Icon size={14} className="text-iris" aria-hidden />
        {label}
      </dt>
      <dd className="font-mono tabular-nums text-ink panel:text-white">{value}</dd>
    </div>
  );
}
