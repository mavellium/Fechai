import { prisma } from "@/lib/prisma";
import {
  MIN_PAYOUT_CENTS,
  nextTierFor,
  tierFor,
  type CommissionTier,
} from "./config";
import { periodMonthOf } from "./service";

/**
 * Números do afiliado: saldo, funil e evolução mês a mês.
 *
 * Tudo é derivado das comissões e dos referrals — não há contador denormalizado
 * que possa divergir. O volume por afiliado é pequeno (dezenas/centenas de
 * linhas), então somar na hora é mais barato do que manter cache correto.
 */

export type AffiliateEarnings = {
  /** Já pago ao afiliado. */
  paidCents: number;
  /** Liberado para saque (passou da janela de estorno), ainda não pago. */
  approvedCents: number;
  /** Ainda na janela de segurança. */
  pendingCents: number;
  /** approved + pending — o que ainda vai entrar. */
  balanceCents: number;
  /** Soma de tudo que já foi ganho (exclui canceladas). */
  lifetimeCents: number;
  /** Receita recorrente mensal estimada: comissão das assinaturas vivas. */
  mrrCents: number;
  canRequestPayout: boolean;
};

export type AffiliateFunnel = {
  clicks: number;
  signups: number;
  active: number;
  churned: number;
  /** Assinaturas pagas ÷ cadastros, em %. */
  conversionRate: number;
};

export type MonthlyPoint = {
  /** "2026-08" */
  month: string;
  /** "ago/26" — rótulo do gráfico. */
  label: string;
  earningsCents: number;
  commissions: number;
};

export type AffiliateOverview = {
  earnings: AffiliateEarnings;
  funnel: AffiliateFunnel;
  monthly: MonthlyPoint[];
  /** Percentual vigente — override do admin, se houver; senão o da faixa. */
  commissionBps: number;
  /** Progresso no programa de níveis. */
  tier: {
    current: CommissionTier;
    /** Vendas ativas que definem a faixa. */
    activeSales: number;
    /** Próxima faixa e quantas vendas faltam; `null` no topo. */
    next: { tier: CommissionTier; salesToGo: number } | null;
    /** True quando o admin fixou um percentual à parte do programa de níveis. */
    overridden: boolean;
  };
};

const MONTH_NAMES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function monthLabel(period: string) {
  const [year, month] = period.split("-");
  const index = Number(month) - 1;
  return `${MONTH_NAMES[index] ?? month}/${year.slice(2)}`;
}

/** Últimos N meses (competências) terminando no mês atual, em ordem crescente. */
function recentMonths(count: number, now = new Date()): string[] {
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(periodMonthOf(d));
  }
  return out;
}

export async function getAffiliateOverview(
  affiliateId: string,
  opts: { months?: number } = {},
): Promise<AffiliateOverview> {
  const months = opts.months ?? 6;

  const [affiliate, byStatus, referralCounts, activeReferrals, monthlyRows] = await Promise.all([
    prisma.affiliate.findUnique({ where: { id: affiliateId }, select: { commissionBps: true } }),
    prisma.affiliateCommission.groupBy({
      by: ["status"],
      where: { affiliateId },
      _sum: { amountCents: true },
    }),
    prisma.referral.groupBy({
      by: ["status"],
      where: { affiliateId },
      _count: { _all: true },
    }),
    // MRR: uma comissão por referral vivo — a mais recente diz quanto aquela
    // assinatura rende hoje. Assinatura cancelada (CHURNED) não entra.
    prisma.referral.findMany({
      where: { affiliateId, status: "CONVERTED" },
      select: {
        commissions: {
          where: { status: { not: "CANCELED" } },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { amountCents: true },
        },
      },
    }),
    prisma.affiliateCommission.groupBy({
      by: ["periodMonth"],
      where: { affiliateId, status: { not: "CANCELED" } },
      _sum: { amountCents: true },
      _count: { _all: true },
    }),
  ]);

  const sumOf = (status: string) =>
    byStatus.find((r) => r.status === status)?._sum.amountCents ?? 0;

  const paidCents = sumOf("PAID");
  const approvedCents = sumOf("APPROVED");
  const pendingCents = sumOf("PENDING");

  const countOf = (status: string) =>
    referralCounts.find((r) => r.status === status)?._count._all ?? 0;

  const clicks = countOf("CLICK");
  const signups = countOf("SIGNED_UP");
  const active = countOf("CONVERTED");
  const churned = countOf("CHURNED");

  // Base da conversão: todo mundo que chegou a criar conta (inclusive quem já
  // assinou ou cancelou depois). Clique puro não entra — não é cadastro.
  const signupBase = signups + active + churned;

  const mrrCents = activeReferrals.reduce(
    (total, r) => total + (r.commissions[0]?.amountCents ?? 0),
    0,
  );

  const monthlyByPeriod = new Map(
    monthlyRows.map((r) => [r.periodMonth, { cents: r._sum.amountCents ?? 0, n: r._count._all }]),
  );
  const monthly: MonthlyPoint[] = recentMonths(months).map((month) => {
    const row = monthlyByPeriod.get(month);
    return {
      month,
      label: monthLabel(month),
      earningsCents: row?.cents ?? 0,
      commissions: row?.n ?? 0,
    };
  });

  return {
    earnings: {
      paidCents,
      approvedCents,
      pendingCents,
      balanceCents: approvedCents + pendingCents,
      lifetimeCents: paidCents + approvedCents + pendingCents,
      mrrCents,
      canRequestPayout: approvedCents >= MIN_PAYOUT_CENTS,
    },
    funnel: {
      clicks: clicks + signupBase, // todo cadastro veio de um clique
      signups: signupBase,
      active,
      churned,
      conversionRate: signupBase > 0 ? Math.round((active / signupBase) * 100) : 0,
    },
    monthly,
    // `active` (referrals CONVERTED) é exatamente a contagem de vendas ativas
    // que `countActiveSales` faz no webhook — reaproveitada aqui para o painel
    // não precisar de outra query nem correr o risco de divergir dela.
    commissionBps: affiliate?.commissionBps ?? tierFor(active).bps,
    tier: {
      current: tierFor(active),
      activeSales: active,
      next: nextTierFor(active),
      overridden: affiliate?.commissionBps != null,
    },
  };
}

/** Indicações recentes para a tabela do painel. */
export async function listReferrals(affiliateId: string, limit = 50) {
  return prisma.referral.findMany({
    where: { affiliateId },
    orderBy: { clickedAt: "desc" },
    take: limit,
    select: {
      id: true,
      status: true,
      planKeyHint: true,
      clickedAt: true,
      signedUpAt: true,
      convertedAt: true,
      tenant: { select: { name: true, planKey: true } },
      commissions: {
        where: { status: { not: "CANCELED" } },
        select: { amountCents: true },
      },
    },
  });
}

/** Extrato de comissões, da mais recente para a mais antiga. */
export async function listCommissions(affiliateId: string, limit = 50) {
  return prisma.affiliateCommission.findMany({
    where: { affiliateId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      amountCents: true,
      baseAmountCents: true,
      commissionBps: true,
      planKey: true,
      status: true,
      periodMonth: true,
      createdAt: true,
      referral: { select: { tenant: { select: { name: true } } } },
    },
  });
}
