import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/session";
import { getAccountRoles, isAffiliateOnly } from "@/modules/affiliates/roles";

/**
 * Porteira das telas do produto (agente de WhatsApp).
 *
 * Esconder o item do menu é aparência, não autorização: quem digitar
 * `/conversas` na barra de endereço ainda chegaria lá. Esta função é a
 * checagem de verdade, e roda no servidor.
 *
 * Quem só afilia é mandado para `/afiliado` — a tela que essa conta de fato
 * tem — em vez de ver um erro. Ligar o papel de cliente em /configuracoes
 * devolve o acesso na hora.
 */
export async function requireProductAccess() {
  const session = await requireOwner();
  const roles = await getAccountRoles(session.user.id);
  if (isAffiliateOnly(roles)) redirect("/afiliado");
  return { session, roles };
}
