import { prisma } from "@/lib/prisma";

/**
 * Papéis da conta: usar o produto, participar do programa de afiliados, ou os
 * dois. Fonte única — o menu, o onboarding, os avisos de teste e as telas de
 * configuração perguntam TODOS aqui.
 *
 * Os dois papéis moram em lugares diferentes por um motivo:
 *  - `usesProduct` é um booleano em `User` (não há "linha de cliente" a criar:
 *    o tenant já existe para toda conta, é o que dá login);
 *  - "afiliado" é a existência de `Affiliate`, que carrega código, percentual
 *    e dados de pagamento — não caberia num booleano.
 *
 * A regra que amarra tudo: **pelo menos um papel sempre ativo**. Uma conta sem
 * nenhum não teria o que mostrar no painel, então desligar o último é barrado
 * na Server Action (ver `(dashboard)/configuracoes/actions.ts`).
 */
export type AccountRoles = {
  /** Usa o agente de WhatsApp: menu completo, onboarding, cotas e trial. */
  usesProduct: boolean;
  /** Está no programa de afiliados: aba /afiliado e visão de ganhos. */
  isAffiliate: boolean;
};

/** Papéis do usuário. Uma query só — usada no layout de toda página do painel. */
export async function getAccountRoles(userId: string): Promise<AccountRoles> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { usesProduct: true, affiliate: { select: { status: true } } },
  });

  // Usuário inexistente não deveria chegar aqui (a sessão já foi validada),
  // mas o fallback mantém o painel utilizável em vez de quebrar a página.
  if (!user) return { usesProduct: true, isAffiliate: false };

  return {
    usesProduct: user.usesProduct,
    // Quem saiu do programa (OPTED_OUT) mantém o cadastro e o histórico, mas
    // não é afiliado ativo: some do menu até reativar em /configuracoes.
    // SUSPENDED continua aparecendo — a pessoa precisa ver o aviso do bloqueio.
    isAffiliate: user.affiliate != null && user.affiliate.status !== "OPTED_OUT",
  };
}

/**
 * Conta que só afilia: não usa o agente.
 *
 * É a pergunta que decide o painel enxuto — sem Agentes/Conversas/WhatsApp, sem
 * onboarding do agente e sem aviso de teste grátis (esse trial é de mensagens
 * da IA, e quem não usa a IA não tem o que testar).
 */
export function isAffiliateOnly(roles: AccountRoles): boolean {
  return roles.isAffiliate && !roles.usesProduct;
}
