import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireTenant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { planOf } from "@/modules/billing/plans";
import { getAgentOwned } from "@/modules/agent-engine/agents";
import { isActionAvailable } from "@/modules/agent-engine/actions";
import { getScheduleConfig } from "@/modules/scheduling/repository";
import type { PersonaAnswers } from "@/modules/agent-engine/persona";
import { AgentWizard } from "./AgentWizard";
import { AgentHeader } from "./AgentHeader";

export default async function AgentePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { tenantId } = await requireTenant();

  const agent = await getAgentOwned(tenantId, id);
  // 404 e não "acesso negado": para quem não é dono, o agente não existe.
  if (!agent) notFound();

  const [tenant, documents, tenantActions, agentCount, scheduleConfig] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { planKey: true } }),
    prisma.knowledgeDocument.findMany({
      where: { tenantId, agentId: agent.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, status: true, createdAt: true, fileUrl: true, fileName: true },
    }),
    prisma.tenantAction.findMany({
      where: { agentId: agent.id, enabled: true },
      select: { key: true },
    }),
    prisma.agent.count({ where: { tenantId, archived: false } }),
    getScheduleConfig(agent.id),
  ]);

  // Desativadas temporariamente não contam como "ação ativa" no checklist.
  const actions = tenantActions.filter((a) => isActionAvailable(a.key));

  const done = {
    persona: agent.systemPrompt.length > 0,
    conhecimento: documents.length > 0,
    acoes: actions.length > 0,
    testar: false,
  };
  // Abre no primeiro passo pendente — quem volta continua de onde parou em vez
  // de cair sempre na persona já preenchida.
  const firstPending = ["persona", "conhecimento", "acoes"].findIndex((k) => !done[k as keyof typeof done]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href="/agentes"
        className="inline-flex items-center gap-1.5 rounded-sm font-mono text-micro uppercase tracking-[0.15em] text-white/55 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
      >
        <ArrowLeft size={13} aria-hidden />
        Todos os agentes
      </Link>

      <AgentHeader
        agent={{
          id: agent.id,
          name: agent.name,
          isPrimary: agent.isPrimary,
          enabled: agent.enabled,
        }}
        canDelete={agentCount > 1}
      />

      <AgentWizard
        agentId={agent.id}
        initialStep={firstPending === -1 ? 3 : firstPending}
        persona={(agent.personaDraft as Partial<PersonaAnswers> | null) ?? {}}
        documents={documents}
        enabledKeys={actions.map((a) => a.key)}
        planLimit={planOf(tenant?.planKey).maxActiveActions}
        scheduleConfig={scheduleConfig}
        enabled={agent.enabled}
        done={done}
      />
    </div>
  );
}
