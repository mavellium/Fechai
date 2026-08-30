/**
 * Regras do programa de afiliados — fonte única.
 *
 * Percentuais em BASIS POINTS (1% = 100 bps). Inteiro de propósito: dinheiro
 * em float acumula erro de arredondamento, e o extrato do afiliado é dinheiro.
 */

/**
 * Níveis de comissão por volume. O afiliado começa em 5% e sobe conforme
 * acumula vendas — a progressão é o próprio incentivo: cada faixa vale mais
 * que a anterior e o salto fica visível no painel ("faltam N vendas").
 *
 * "Venda" aqui é uma indicação que VIROU ASSINANTE PAGANTE e continua ativa
 * (`Referral.status === "CONVERTED"`), de qualquer plano. Quem cancelou sai da
 * contagem: o nível reflete a carteira viva, não um recorde histórico — é a
 * mesma base do MRR mostrado no painel.
 *
 * Ordem decrescente de propósito: `tierFor` devolve o PRIMEIRO que couber.
 */
export const COMMISSION_TIERS = [
  { minSales: 100, bps: 2000, label: "Diamante" },
  { minSales: 25, bps: 1500, label: "Ouro" },
  { minSales: 5, bps: 1000, label: "Prata" },
  { minSales: 0, bps: 500, label: "Bronze" },
] as const;

export type CommissionTier = (typeof COMMISSION_TIERS)[number];

/** Faixa de entrada (5%): é o que vale para quem ainda não vendeu nada. */
export const DEFAULT_COMMISSION_BPS = COMMISSION_TIERS[COMMISSION_TIERS.length - 1].bps;

/** Teto do programa — usado na comunicação ("até 20%"). */
export const MAX_COMMISSION_BPS = COMMISSION_TIERS[0].bps;

/** Faixa correspondente a um número de vendas ativas. */
export function tierFor(activeSales: number): CommissionTier {
  return (
    COMMISSION_TIERS.find((t) => activeSales >= t.minSales) ??
    COMMISSION_TIERS[COMMISSION_TIERS.length - 1]
  );
}

/**
 * Próxima faixa e quantas vendas faltam para alcançá-la. `null` quando o
 * afiliado já está no topo — aí não há o que perseguir.
 */
export function nextTierFor(
  activeSales: number,
): { tier: CommissionTier; salesToGo: number } | null {
  // A lista é decrescente; a próxima meta é a última faixa acima da atual.
  const above = COMMISSION_TIERS.filter((t) => t.minSales > activeSales);
  if (above.length === 0) return null;
  const tier = above[above.length - 1];
  return { tier, salesToGo: tier.minSales - activeSales };
}

/**
 * Janela de segurança antes de liberar o saque. O pagamento de origem ainda
 * pode ser estornado (reembolso/chargeback); aprovar antes disso seria pagar
 * comissão sobre dinheiro que voltou.
 */
export const COMMISSION_HOLD_DAYS = 30;

/** Valor mínimo acumulado (centavos) para solicitar saque — R$ 100. */
export const MIN_PAYOUT_CENTS = 10_000;

/**
 * Validade do cookie de indicação, em dias. Quem clica hoje e assina em duas
 * semanas ainda credita o afiliado — janela padrão do mercado.
 */
export const REFERRAL_COOKIE_DAYS = 30;

/** Nome do cookie que carrega o código do afiliado até o cadastro. */
export const REFERRAL_COOKIE = "fechai_ref";

/** Parâmetro de URL que o afiliado divulga: /?ref=CODIGO */
export const REFERRAL_PARAM = "ref";

/** Parâmetro opcional que marca qual plano o link divulga: ?plano=PRO */
export const REFERRAL_PLAN_PARAM = "plano";

export function bpsToPercentLabel(bps: number) {
  const pct = bps / 100;
  // Sem casa decimal quando é redondo (20%), com uma casa quando não (12,5%).
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(1).replace(".", ",")}%`;
}

/**
 * Comissão de um pagamento, em centavos. Arredonda para baixo: nunca pagar
 * mais do que o percentual — o centavo quebrado fica com a casa, não vira
 * dívida silenciosa.
 */
export function commissionOf(baseAmountCents: number, bps: number) {
  return Math.floor((baseAmountCents * bps) / 10_000);
}
