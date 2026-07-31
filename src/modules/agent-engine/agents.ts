import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { planOf } from "@/modules/billing/plans";
import { DEFAULT_ACTION_KEYS } from "@/modules/tenants/provision";

/**
 * Regras de agente por conta. Tudo que envolve "quantos posso ter" e "este
 * agente é meu?" mora aqui — as server actions e as páginas só consomem, para
 * a checagem de limite não voltar a ser reescrita em cada tela (foi o que
 * aconteceu com `maxActiveActions`, ver revisão de UI do painel).
 */

export type AgentUsage = {
  used: number;
  limit: number;
  remaining: number;
  canCreate: boolean;
};

/** Quantos agentes a conta tem contra o teto do plano. */
export async function getAgentUsage(tenantId: string): Promise<AgentUsage> {
  const [tenant, used] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { planKey: true } }),
    prisma.agent.count({ where: { tenantId, archived: false } }),
  ]);
  const limit = planOf(tenant?.planKey).maxAgents;
  return { used, limit, remaining: Math.max(0, limit - used), canCreate: used < limit };
}

/**
 * Busca um agente garantindo que ele é da conta. Toda leitura/escrita por id
 * vinda da URL passa por aqui — sem isso, trocar o id na barra de endereço
 * daria acesso ao agente de outra conta.
 */
export async function getAgentOwned(tenantId: string, agentId: string) {
  return prisma.agent.findFirst({ where: { id: agentId, tenantId } });
}

/** Agentes ativos da conta, principal primeiro, com contadores para a lista. */
export async function listAgents(tenantId: string) {
  return prisma.agent.findMany({
    where: { tenantId, archived: false },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    include: {
      _count: { select: { knowledgeDocs: true, conversations: true } },
      actions: { where: { enabled: true }, select: { key: true } },
    },
  });
}

/**
 * Cria um agente já com as 5 ações padrão (desligadas), como o provisionamento
 * de conta faz. O primeiro agente da conta vira o principal — a conta nunca
 * fica sem alguém atendendo o WhatsApp.
 */
export async function createAgent(
  tenantId: string,
  name: string,
  tx: Prisma.TransactionClient = prisma,
) {
  const isFirst = (await tx.agent.count({ where: { tenantId, archived: false } })) === 0;
  return tx.agent.create({
    data: {
      tenantId,
      name,
      isPrimary: isFirst,
      actions: { create: DEFAULT_ACTION_KEYS.map((key) => ({ tenantId, key, enabled: false })) },
    },
  });
}

/** Progresso do passo a passo — usado na lista e no cabeçalho do wizard. */
export function agentSteps(agent: {
  systemPrompt: string;
  _count: { knowledgeDocs: number };
  actions: { key: string }[];
}) {
  return [
    { key: "persona", label: "Persona", done: agent.systemPrompt.length > 0 },
    { key: "conhecimento", label: "Conhecimento", done: agent._count.knowledgeDocs > 0 },
    { key: "acoes", label: "Ações", done: agent.actions.length > 0 },
  ];
}
