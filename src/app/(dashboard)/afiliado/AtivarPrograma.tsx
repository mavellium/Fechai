"use client";

import { useActionState } from "react";
import { HandCoins, Link2, TrendingUp, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { PLANS } from "@/modules/billing/plans";
import {
  bpsToPercentLabel,
  commissionOf,
  COMMISSION_TIERS,
  DEFAULT_COMMISSION_BPS,
  MAX_COMMISSION_BPS,
} from "@/modules/affiliates/config";
import { formatBRL } from "@/lib/format";
import { activateAffiliate, type ActionState } from "./actions";

/**
 * Tela de entrada para quem tem conta mas ainda não é afiliado.
 *
 * Não é um estado vazio genérico: é a mesma oferta da landing, condensada,
 * porque a pessoa aqui já é cliente — o público que melhor converte. Um clique
 * ativa (não há formulário: todos os dados necessários já vieram no cadastro).
 */
export function AtivarPrograma() {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    async () => activateAffiliate(),
    null,
  );

  const pro = PLANS.find((p) => p.highlight) ?? PLANS[1];
  const ganhoPro = commissionOf(pro.priceCents, DEFAULT_COMMISSION_BPS);
  const inicial = bpsToPercentLabel(DEFAULT_COMMISSION_BPS);
  const maximo = bpsToPercentLabel(MAX_COMMISSION_BPS);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <PageHeader
        eyebrow="afiliado"
        title="Ganhe indicando o fechai"
        description={`Você recebe de ${inicial} a ${maximo} de cada mensalidade paga por quem entrar pelo seu link — todo mês, enquanto a assinatura durar. O percentual sobe conforme suas vendas.`}
      />

      <Card>
        <CardTitle hint="Sem custo, sem meta mínima e sem exclusividade.">
          Como funciona
        </CardTitle>

        <ul className="space-y-4">
          <Item
            icon={Link2}
            titulo="Você gera um link para cada plano"
            desc="Compartilhe no WhatsApp, nas redes ou com quem já te pergunta como você atende tão rápido."
          />
          <Item
            icon={TrendingUp}
            titulo="Acompanha tudo pelo painel"
            desc="Cliques, cadastros, assinaturas e o extrato de comissões, atualizados a cada pagamento."
          />
          <Item
            icon={Wallet}
            titulo="Recebe todo mês, via Pix"
            desc={`Uma indicação do plano ${pro.name} paga ${formatBRL(ganhoPro)} por mês já no nível inicial — e mais conforme você sobe de faixa.`}
          />
        </ul>

        {/* A escada em texto: o argumento de entrada não é o 5%, é o caminho
            até o 20% — e ele precisa estar visível antes do botão. */}
        <div className="mt-6 rounded-control border border-ink/10 p-4 panel:border-white/10">
          <p className="font-mono text-micro uppercase tracking-[0.2em] text-neutral panel:text-white/55">
            níveis de comissão
          </p>
          <ul className="mt-3 space-y-1.5 text-sm">
            {[...COMMISSION_TIERS].reverse().map((t) => (
              <li key={t.minSales} className="flex items-center justify-between gap-3">
                <span className="text-neutral panel:text-white/60">
                  {t.label}
                  <span className="text-neutral/70 panel:text-white/40">
                    {t.minSales === 0 ? " · da 1ª venda" : ` · ${t.minSales}+ vendas ativas`}
                  </span>
                </span>
                <span className="font-mono tabular-nums text-ink panel:text-white">
                  {bpsToPercentLabel(t.bps)}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <form action={action} className="mt-8 border-t border-ink/10 pt-6 panel:border-white/10">
          <Button type="submit" variant="cta" loading={pending}>
            <HandCoins size={16} aria-hidden />
            Ativar meu programa de afiliado
          </Button>

          {state?.error && (
            <p role="alert" className="mt-3 text-sm text-danger">
              {state.error}
            </p>
          )}
          {state?.ok && (
            <p role="status" className="mt-3 text-sm text-success">
              {state.ok}
            </p>
          )}
        </form>
      </Card>
    </div>
  );
}

function Item({
  icon: Icon,
  titulo,
  desc,
}: {
  icon: typeof Link2;
  titulo: string;
  desc: string;
}) {
  return (
    <li className="flex gap-3">
      <Icon size={18} className="mt-0.5 shrink-0 text-iris" aria-hidden />
      <div>
        <p className="font-display text-sm font-semibold text-ink panel:text-white">{titulo}</p>
        <p className="mt-1 text-sm leading-relaxed text-neutral panel:text-white/60">{desc}</p>
      </div>
    </li>
  );
}
