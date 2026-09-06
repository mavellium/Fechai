import type { Metadata } from "next";
import { HandCoins, TrendingUp, Users, Wallet } from "lucide-react";
import { requireOwner } from "@/lib/session";
import { SITE_URL } from "@/lib/seo";
import { formatBRL, dateTimeLabel } from "@/lib/format";
import {
  approveMaturedCommissions,
  getAffiliateByUser,
} from "@/modules/affiliates/service";
import { getAffiliateOverview, listCommissions, listReferrals } from "@/modules/affiliates/stats";
import { bpsToPercentLabel, MIN_PAYOUT_CENTS } from "@/modules/affiliates/config";
import { COMMISSION_LABELS, REFERRAL_LABELS } from "@/modules/affiliates/labels";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FadeIn } from "@/components/ui/FadeIn";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { LinkGenerator } from "./LinkGenerator";
import { TierProgress } from "./TierProgress";
import { AtivarPrograma } from "./AtivarPrograma";
import { PayoutForm } from "./PayoutForm";

export const metadata: Metadata = {
  title: "Afiliado",
  robots: { index: false, follow: false },
};

export default async function AfiliadoPage() {
  const session = await requireOwner();
  const affiliate = await getAffiliateByUser(session.user.id);

  // Quem criou a conta só como cliente ainda não tem cadastro no programa.
  // Em vez de esconder a aba, a tela explica o programa e oferece a ativação
  // em um clique — é o caminho mais barato de conseguir um novo afiliado.
  if (!affiliate) return <AtivarPrograma />;

  // Saiu do programa por conta própria (/configuracoes): oferece a volta, sem
  // o tom de punição da tela de suspensão. Normalmente nem chega aqui — o item
  // some do menu —, mas a URL continua acessível.
  if (affiliate.status === "OPTED_OUT") {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader eyebrow="afiliado" title="Você saiu do programa" />
        <Card>
          <EmptyState
            icon={HandCoins}
            title="Seu cadastro continua guardado"
            description="Código, indicações e comissões seguem salvos. Reative em Configurações e você volta com o mesmo link de sempre."
            action={<ButtonLink href="/configuracoes">Ir para Configurações</ButtonLink>}
          />
        </Card>
      </div>
    );
  }

  if (affiliate.status === "SUSPENDED") {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader eyebrow="afiliado" title="Programa suspenso" />
        <Card>
          <EmptyState
            icon={HandCoins}
            title="Seu acesso ao programa está suspenso"
            description="Seus links pararam de gerar novas indicações. As comissões já aprovadas continuam válidas — fale com o suporte para entender o motivo."
          />
        </Card>
      </div>
    );
  }

  // Amadurece o que já passou da janela de estorno antes de mostrar o saldo,
  // para o número na tela ser o número real (não depende de cron no MVP).
  await approveMaturedCommissions(affiliate.id);

  const [overview, referrals, commissions] = await Promise.all([
    getAffiliateOverview(affiliate.id),
    listReferrals(affiliate.id, 25),
    listCommissions(affiliate.id, 25),
  ]);

  const { earnings, funnel } = overview;

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6">
      <PageHeader
        eyebrow="afiliado"
        title="Seu programa de afiliados"
        description={`Você ganha ${bpsToPercentLabel(overview.commissionBps)} de cada mensalidade paga pelos clientes que indicar — todo mês, enquanto durar a assinatura.${
          overview.tier.next
            ? ` Mais ${overview.tier.next.salesToGo} ${overview.tier.next.salesToGo === 1 ? "venda" : "vendas"} e o percentual sobe para ${bpsToPercentLabel(overview.tier.next.tier.bps)}.`
            : ""
        }`}
      />

      <FadeIn>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat
            label="Receita mensal"
            value={formatBRL(earnings.mrrCents)}
            hint="soma das assinaturas ativas que você indicou"
          />
          <Stat
            label="Disponível para saque"
            value={formatBRL(earnings.approvedCents)}
            hint={
              earnings.canRequestPayout
                ? "acima do mínimo — solicite o saque"
                : `mínimo de ${formatBRL(MIN_PAYOUT_CENTS)} para sacar`
            }
          />
          <Stat
            label="Em análise"
            value={formatBRL(earnings.pendingCents)}
            hint="libera 30 dias após cada pagamento"
          />
          <Stat
            label="Total já ganho"
            value={formatBRL(earnings.lifetimeCents)}
            hint={`${formatBRL(earnings.paidCents)} já pagos`}
          />
        </div>
      </FadeIn>

      <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <LinkGenerator
          code={affiliate.code}
          siteUrl={SITE_URL}
          commissionBps={overview.commissionBps}
        />

        <div className="space-y-6">
          <TierProgress tier={overview.tier} />

          <Card>
            <CardTitle hint="Do clique até a assinatura paga.">Seu funil</CardTitle>
            <dl className="space-y-3">
              <FunilLinha icon={Users} label="Cadastros" value={funnel.signups} />
              <FunilLinha icon={TrendingUp} label="Assinantes ativos" value={funnel.active} />
              <FunilLinha icon={Wallet} label="Cancelaram" value={funnel.churned} />
              <div className="flex items-baseline justify-between border-t border-ink/10 pt-3 panel:border-white/10">
                <dt className="text-sm text-neutral panel:text-white/60">Conversão</dt>
                <dd className="font-display text-lg font-semibold tabular-nums text-ink panel:text-white">
                  {funnel.conversionRate}%
                </dd>
              </div>
            </dl>
          </Card>

          <PayoutForm
            pixKey={affiliate.payoutPixKey ?? ""}
            holderName={affiliate.payoutName ?? ""}
          />
        </div>
      </div>

      <Card>
        <CardTitle hint="As contas criadas pelos seus links.">Suas indicações</CardTitle>
        {referrals.length === 0 ? (
          <EmptyState
            icon={Users}
            title="Nenhuma indicação ainda"
            description="Compartilhe um dos links acima. Assim que alguém criar uma conta por ele, a indicação aparece aqui."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-ink/10 text-left panel:border-white/10">
                  <Th>Conta</Th>
                  <Th>Situação</Th>
                  <Th>Plano</Th>
                  <Th className="text-right">Já rendeu</Th>
                  <Th className="text-right">Entrada</Th>
                </tr>
              </thead>
              <tbody>
                {referrals.map((r) => {
                  const total = r.commissions.reduce((s, c) => s + c.amountCents, 0);
                  const status = REFERRAL_LABELS[r.status];
                  return (
                    <tr
                      key={r.id}
                      className="border-b border-ink/5 last:border-0 panel:border-white/5"
                    >
                      <Td className="font-medium text-ink panel:text-white">
                        {/* Nome do negócio indicado; sem conta ainda, é só clique. */}
                        {r.tenant?.name ?? "—"}
                      </Td>
                      <Td>
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </Td>
                      <Td className="text-neutral panel:text-white/60">
                        {r.tenant?.planKey ?? r.planKeyHint ?? "—"}
                      </Td>
                      <Td className="text-right font-mono tabular-nums text-ink panel:text-white">
                        {formatBRL(total)}
                      </Td>
                      <Td className="text-right text-neutral panel:text-white/55">
                        {dateTimeLabel(r.signedUpAt ?? r.clickedAt)}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardTitle hint="Cada mensalidade paga gera uma linha.">Extrato de comissões</CardTitle>
        {commissions.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title="Nenhuma comissão ainda"
            description="A primeira comissão aparece assim que uma pessoa indicada por você pagar a primeira mensalidade."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-ink/10 text-left panel:border-white/10">
                  <Th>Competência</Th>
                  <Th>Cliente</Th>
                  <Th>Plano</Th>
                  <Th>Situação</Th>
                  <Th className="text-right">Comissão</Th>
                </tr>
              </thead>
              <tbody>
                {commissions.map((c) => {
                  const status = COMMISSION_LABELS[c.status];
                  return (
                    <tr
                      key={c.id}
                      className="border-b border-ink/5 last:border-0 panel:border-white/5"
                    >
                      <Td className="font-mono text-xs text-neutral panel:text-white/60">
                        {c.periodMonth}
                      </Td>
                      <Td className="text-ink panel:text-white">
                        {c.referral.tenant?.name ?? "—"}
                      </Td>
                      <Td className="text-neutral panel:text-white/60">{c.planKey}</Td>
                      <Td>
                        <Badge tone={status.tone} title={status.hint}>
                          {status.label}
                        </Badge>
                      </Td>
                      <Td className="text-right font-mono tabular-nums text-ink panel:text-white">
                        {formatBRL(c.amountCents)}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function FunilLinha({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Users;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="flex items-center gap-2 text-sm text-neutral panel:text-white/60">
        <Icon size={14} className="text-iris" aria-hidden />
        {label}
      </dt>
      <dd className="font-mono tabular-nums text-ink panel:text-white">{value}</dd>
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={`pb-3 pr-4 font-mono text-micro font-normal uppercase tracking-[0.15em] text-neutral panel:text-white/50 ${className ?? ""}`}
    >
      {children}
    </th>
  );
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={`py-3 pr-4 ${className ?? ""}`}>{children}</td>;
}
