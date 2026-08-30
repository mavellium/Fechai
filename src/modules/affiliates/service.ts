import type { PlanKey, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { PLAN_BY_KEY } from "@/modules/billing/plans";
import { generateAffiliateCode, normalizeCode } from "./code";
import { COMMISSION_HOLD_DAYS, commissionOf, tierFor } from "./config";

/** Competência "2026-08" usada para agrupar o extrato mensal. */
export function periodMonthOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Cria (ou devolve) o cadastro de afiliado do usuário. Idempotente: chamar de
 * novo não gera um segundo código, senão o link já divulgado morreria.
 *
 * A colisão de `code` é tratada por retry em vez de checar antes: o índice
 * único é a única garantia real sob concorrência, e com 31^7 combinações a
 * segunda volta é praticamente inalcançável.
 */
export async function ensureAffiliate(userId: string) {
  const existing = await prisma.affiliate.findUnique({ where: { userId } });
  if (existing) return existing;

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await prisma.affiliate.create({
        data: { userId, code: generateAffiliateCode() },
      });
    } catch (err) {
      // P2002 = violação de unicidade. Em `userId` significa que outra
      // requisição criou o afiliado no meio do caminho — devolve o dela.
      const code = (err as { code?: string }).code;
      if (code !== "P2002") throw err;
      const raced = await prisma.affiliate.findUnique({ where: { userId } });
      if (raced) return raced;
      // Colidiu no `code`: tenta outro.
    }
  }
  throw new Error("Não foi possível gerar um código de afiliado. Tente de novo.");
}

export async function getAffiliateByUser(userId: string) {
  return prisma.affiliate.findUnique({ where: { userId } });
}

/** Afiliado ativo a partir do código do link. Null se não existe ou não pode converter. */
export async function findActiveAffiliateByCode(rawCode: string) {
  const code = normalizeCode(rawCode);
  if (!code) return null;
  const affiliate = await prisma.affiliate.findUnique({ where: { code } });
  return affiliate?.status === "ACTIVE" ? affiliate : null;
}

/**
 * Registra o clique no link. Best-effort: é métrica de topo de funil, então
 * uma falha aqui nunca pode impedir a pessoa de ver a landing.
 */
export async function trackClick(opts: {
  code: string;
  landingPath?: string;
  planKeyHint?: PlanKey | null;
  utmSource?: string | null;
}) {
  try {
    const affiliate = await findActiveAffiliateByCode(opts.code);
    if (!affiliate) return null;
    return await prisma.referral.create({
      data: {
        affiliateId: affiliate.id,
        status: "CLICK",
        landingPath: opts.landingPath,
        planKeyHint: opts.planKeyHint ?? undefined,
        utmSource: opts.utmSource ?? undefined,
      },
    });
  } catch (err) {
    console.error("[affiliates] falha ao registrar clique", err);
    return null;
  }
}

/**
 * Credita a conta recém-criada ao afiliado do código.
 *
 * Regra de crédito: FIRST-TOUCH e uma vez só. `Referral.tenantId` é único no
 * banco, então se o tenant já está creditado a alguém, a chamada é ignorada —
 * duas pessoas não disputam a mesma indicação.
 *
 * Roda dentro da transação do cadastro quando `client` é passado, para a conta
 * e a indicação nascerem juntas ou não nascerem.
 */
export async function attachReferralToTenant(opts: {
  code: string;
  tenantId: string;
  planKeyHint?: PlanKey | null;
  client?: Prisma.TransactionClient;
}) {
  const db = opts.client ?? prisma;
  const code = normalizeCode(opts.code);
  if (!code) return null;

  const affiliate = await db.affiliate.findUnique({ where: { code } });
  if (!affiliate || affiliate.status !== "ACTIVE") return null;

  const already = await db.referral.findUnique({ where: { tenantId: opts.tenantId } });
  if (already) return already;

  // Aproveita um clique recente e ainda não convertido do mesmo afiliado, para
  // o funil não contar clique e cadastro como duas pessoas diferentes.
  const pendingClick = await db.referral.findFirst({
    where: { affiliateId: affiliate.id, status: "CLICK", tenantId: null },
    orderBy: { clickedAt: "desc" },
  });

  const data = {
    tenantId: opts.tenantId,
    status: "SIGNED_UP" as const,
    signedUpAt: new Date(),
    planKeyHint: opts.planKeyHint ?? pendingClick?.planKeyHint ?? undefined,
  };

  try {
    if (pendingClick) {
      return await db.referral.update({ where: { id: pendingClick.id }, data });
    }
    return await db.referral.create({ data: { affiliateId: affiliate.id, ...data } });
  } catch (err) {
    // Corrida no índice único de tenantId: alguém creditou primeiro, e o
    // first-touch manda respeitar quem chegou antes.
    if ((err as { code?: string }).code === "P2002") {
      return db.referral.findUnique({ where: { tenantId: opts.tenantId } });
    }
    throw err;
  }
}

/**
 * Vendas ativas do afiliado: indicações que viraram assinatura paga e não
 * cancelaram. É a base do nível de comissão (ver `COMMISSION_TIERS`) e a mesma
 * contagem que o painel mostra como "assinantes ativos" — um número só, para
 * o nível na tela nunca divergir do nível que o webhook aplica.
 */
export async function countActiveSales(affiliateId: string) {
  return prisma.referral.count({ where: { affiliateId, status: "CONVERTED" } });
}

/**
 * Registra a comissão de UM pagamento da assinatura indicada e marca o
 * referral como convertido.
 *
 * Idempotente por `stripeEventId` (índice único): o Stripe reentrega webhooks,
 * e sem essa trava a mesma fatura pagaria o afiliado duas vezes.
 *
 * O percentual vigente é COPIADO para a linha — mudar a regra amanhã não pode
 * reescrever o que já foi ganho.
 */
export async function recordCommissionForPayment(opts: {
  tenantId: string;
  planKey: PlanKey;
  /** Valor efetivamente pago (centavos). Sem ele, usa o preço de tabela do plano. */
  amountPaidCents?: number;
  stripeEventId?: string;
  stripeInvoiceId?: string;
}) {
  const referral = await prisma.referral.findUnique({
    where: { tenantId: opts.tenantId },
    include: { affiliate: true },
  });
  if (!referral) return null; // conta não veio de afiliado — caso comum
  // Só afiliado ATIVO acumula comissão nova. Cobre tanto o bloqueio do admin
  // (SUSPENDED) quanto a saída voluntária (OPTED_OUT) — o que já foi ganho
  // continua no extrato dos dois casos.
  if (referral.affiliate.status !== "ACTIVE") return null;

  const base = opts.amountPaidCents ?? PLAN_BY_KEY[opts.planKey]?.priceCents ?? 0;
  if (base <= 0) return null; // plano grátis não gera comissão

  /**
   * Percentual desta parcela.
   *
   * `commissionBps` no afiliado é um OVERRIDE do admin (acordo particular) e
   * ganha de tudo. Sem ele, vale a faixa por volume, calculada agora — assim a
   * mensalidade que fecha a 5ª venda já sai a 10%, sem esperar o próximo ciclo.
   *
   * A venda que está sendo convertida NESTE pagamento conta para a própria
   * faixa: ela ainda não é `CONVERTED` no banco (a atualização vem abaixo),
   * então entra somada à parte. Sem isso, a 5ª venda pagaria à taxa de 4.
   */
  const activeSales = await countActiveSales(referral.affiliateId);
  const salesForTier = referral.status === "CONVERTED" ? activeSales : activeSales + 1;
  const bps = referral.affiliate.commissionBps ?? tierFor(salesForTier).bps;

  const amount = commissionOf(base, bps);
  if (amount <= 0) return null;

  const now = new Date();

  try {
    const commission = await prisma.affiliateCommission.create({
      data: {
        affiliateId: referral.affiliateId,
        referralId: referral.id,
        baseAmountCents: base,
        amountCents: amount,
        commissionBps: bps,
        planKey: opts.planKey,
        status: "PENDING",
        stripeEventId: opts.stripeEventId,
        stripeInvoiceId: opts.stripeInvoiceId,
        periodMonth: periodMonthOf(now),
      },
    });

    // Primeiro pagamento: o lead vira cliente de verdade.
    if (referral.status !== "CONVERTED") {
      await prisma.referral.update({
        where: { id: referral.id },
        data: { status: "CONVERTED", convertedAt: referral.convertedAt ?? now, churnedAt: null },
      });
    }

    return commission;
  } catch (err) {
    // Evento reentregue pelo Stripe: a comissão já existe, nada a fazer.
    if ((err as { code?: string }).code === "P2002") return null;
    throw err;
  }
}

/** Assinatura cancelada: para de gerar comissão nova (as antigas permanecem). */
export async function markReferralChurned(tenantId: string) {
  const referral = await prisma.referral.findUnique({ where: { tenantId } });
  if (!referral || referral.status === "CHURNED") return;
  await prisma.referral.update({
    where: { id: referral.id },
    data: { status: "CHURNED", churnedAt: new Date() },
  });
}

/**
 * Libera para saque as comissões que já passaram da janela de estorno.
 * Chamada sob demanda ao abrir o painel — evita depender de cron no MVP.
 */
export async function approveMaturedCommissions(affiliateId: string) {
  const cutoff = new Date(Date.now() - COMMISSION_HOLD_DAYS * 24 * 60 * 60 * 1000);
  await prisma.affiliateCommission.updateMany({
    where: { affiliateId, status: "PENDING", createdAt: { lte: cutoff } },
    data: { status: "APPROVED", approvedAt: new Date() },
  });
}
