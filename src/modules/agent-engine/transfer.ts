import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { planOf } from "@/modules/billing/plans";
import { ingestDocument } from "@/modules/knowledge-base/repository";
import { ACTION_CATALOG, isActionAvailable } from "./actions";
import { catalogVoiceByReferenceId, findCatalogVoice } from "@/modules/voice/catalog";
import type { AgentPackage } from "./agent-package";
import { AGENT_PACKAGE_FORMAT, AGENT_PACKAGE_VERSION } from "./agent-package";
import { parseVariableDefinitions } from "./variables";

export type AgentTransferResult =
  | { ok: true; agentId: string; name: string; warnings: string[] }
  | { ok: false; error: string };

/** Monta o pacote sem conversas, contatos, agenda ou ids internos. */
export async function buildAgentPackage(
  agentId: string,
  sourceTenantId?: string,
): Promise<AgentPackage | null> {
  const agent = await prisma.agent.findFirst({
    where: { id: agentId, ...(sourceTenantId ? { tenantId: sourceTenantId } : {}) },
    select: {
      name: true,
      systemPrompt: true,
      objective: true,
      personaDraft: true,
      variableDefinitions: true,
      listenAudio: true,
      stopOnEmoji: true,
      speakReplies: true,
      voiceId: true,
      voiceSource: true,
      voiceStyle: true,
      voicePrompt: true,
      speechBlocklist: true,
      tenant: { select: { name: true } },
      actions: {
        orderBy: { key: "asc" },
        select: { key: true, enabled: true, config: true },
      },
      knowledgeDocs: {
        orderBy: { createdAt: "asc" },
        select: { title: true, content: true },
      },
    },
  });
  if (!agent) return null;

  const catalogVoice =
    agent.voiceSource === "catalog" ? catalogVoiceByReferenceId(agent.voiceId) : undefined;

  return {
    format: AGENT_PACKAGE_FORMAT,
    version: AGENT_PACKAGE_VERSION,
    exportedAt: new Date().toISOString(),
    source: { tenantName: agent.tenant.name },
    agent: {
      name: agent.name,
      systemPrompt: agent.systemPrompt,
      objective: agent.objective,
      personaDraft: agent.personaDraft,
      variableDefinitions: parseVariableDefinitions(agent.variableDefinitions),
      listenAudio: agent.listenAudio,
      stopOnEmoji: agent.stopOnEmoji,
      speakReplies: agent.speakReplies,
      voiceStyle: agent.voiceStyle,
      voicePrompt: agent.voicePrompt,
      speechBlocklist: agent.speechBlocklist,
      catalogVoiceKey: catalogVoice?.key ?? null,
    },
    actions: agent.actions.map((action) => ({
      key: action.key,
      enabled: action.enabled,
      config: action.config,
    })),
    knowledge: agent.knowledgeDocs,
  };
}

/**
 * Cria uma cópia funcional e isolada. O agente nasce desligado e não principal:
 * importar não pode trocar silenciosamente quem atende clientes reais.
 */
export async function createAgentFromPackage(input: {
  tenantId: string;
  package: AgentPackage;
  name?: string;
}): Promise<AgentTransferResult> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: input.tenantId },
    select: {
      planKey: true,
      _count: { select: { agents: { where: { archived: false } } } },
    },
  });
  if (!tenant) return { ok: false, error: "Empresa de destino não encontrada." };

  const plan = planOf(tenant.planKey);
  if (tenant._count.agents >= plan.maxAgents) {
    return {
      ok: false,
      error: `A empresa de destino já atingiu o limite de ${plan.maxAgents} agente(s) do plano.`,
    };
  }

  const warnings: string[] = [];
  const voice = input.package.agent.catalogVoiceKey
    ? findCatalogVoice(input.package.agent.catalogVoiceKey)
    : undefined;
  if (input.package.agent.speakReplies && !voice) {
    warnings.push("A resposta em áudio ficou desligada porque a voz gravada não é transportável.");
  }

  const sourceActions = new Map(input.package.actions.map((action) => [action.key, action]));
  let enabledCount = 0;
  let actionsDisabledByPlan = 0;
  const actions = ACTION_CATALOG.map((definition) => {
    const source = sourceActions.get(definition.key);
    const wanted = Boolean(source?.enabled && isActionAvailable(definition.key));
    const enabled = wanted && enabledCount < plan.maxActiveActions;
    if (enabled) enabledCount++;
    else if (wanted) actionsDisabledByPlan++;
    return {
      tenantId: input.tenantId,
      key: definition.key,
      enabled,
      config: (source?.config ?? undefined) as Prisma.InputJsonValue | undefined,
    };
  });
  if (actionsDisabledByPlan > 0) {
    warnings.push(
      `${actionsDisabledByPlan} habilidade(s) ficaram desligadas por causa do limite do plano de destino.`,
    );
  }

  const name = (input.name?.trim() || input.package.agent.name).slice(0, 60);
  let createdId: string | null = null;
  try {
    const created = await prisma.agent.create({
      data: {
        tenantId: input.tenantId,
        name,
        systemPrompt: input.package.agent.systemPrompt,
        objective: input.package.agent.objective,
        personaDraft: (input.package.agent.personaDraft ?? undefined) as
          | Prisma.InputJsonValue
          | undefined,
        variableDefinitions: input.package.agent.variableDefinitions,
        isPrimary: false,
        enabled: false,
        listenAudio: input.package.agent.listenAudio,
        stopOnEmoji: input.package.agent.stopOnEmoji,
        speakReplies: Boolean(voice && input.package.agent.speakReplies),
        voiceId: voice?.referenceId ?? null,
        voiceLabel: voice?.name ?? null,
        voiceSource: voice ? "catalog" : null,
        voiceCreatedAt: voice ? new Date() : null,
        voiceStyle: input.package.agent.voiceStyle,
        voicePrompt: input.package.agent.voicePrompt,
        speechBlocklist: input.package.agent.speechBlocklist,
        actions: { create: actions },
      },
      select: { id: true, name: true },
    });
    createdId = created.id;

    // `ingestDocument` recria chunks e embeddings para o novo agentId. Copiar
    // as linhas cruas deixaria vetores apontando para o agente de origem.
    for (const document of input.package.knowledge) {
      await ingestDocument({
        tenantId: input.tenantId,
        agentId: created.id,
        title: document.title,
        content: document.content,
      });
    }

    return { ok: true, agentId: created.id, name: created.name, warnings };
  } catch (error) {
    if (createdId) {
      await prisma.agent.deleteMany({ where: { id: createdId, tenantId: input.tenantId } });
    }
    console.error("[agent-transfer] falha ao criar agente", error);
    return { ok: false, error: "Não foi possível criar a cópia completa do agente." };
  }
}
