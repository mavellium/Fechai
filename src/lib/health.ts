import { prisma } from "@/lib/prisma";
import { isStripeConfigured } from "@/modules/billing/stripe";
import { isEmbeddingConfigured } from "@/modules/knowledge-base/embeddings";
import { getWhatsAppProvider } from "@/modules/whatsapp";
import { AVAILABLE_ACTIONS } from "@/modules/agent-engine/actions";

export type Check = {
  label: string;
  ok: boolean;
  detail?: string;
  /** Onde o usuário resolve esta pendência. Só faz sentido nos checks de tenant. */
  href?: string;
};

// Integrações externas — configuradas via env? (não faz chamada de rede)
export function integrationChecks(): Check[] {
  return [
    {
      label: "IA (respostas + embeddings)",
      ok: isEmbeddingConfigured(),
      detail: process.env.GEMINI_API_KEY ? "GEMINI_API_KEY" : "GEMINI_API_KEY/OPENAI_API_KEY",
    },
    { label: "Stripe (pagamentos)", ok: isStripeConfigured(), detail: "STRIPE_SECRET_KEY" },
    { label: "Evolution API (WhatsApp)", ok: getWhatsAppProvider().isConfigured(), detail: "EVOLUTION_API_URL/KEY" },
    { label: "Redis (follow-up)", ok: Boolean(process.env.REDIS_URL), detail: "REDIS_URL" },
  ];
}

// Saúde do tenant — passos de configuração concluídos?
export async function tenantChecks(tenantId: string): Promise<Check[]> {
  const [agentWithPrompt, docs, actions, wa] = await Promise.all([
    prisma.agent.findFirst({
      where: { tenantId, archived: false, NOT: { systemPrompt: "" } },
      select: { id: true },
    }),
    prisma.knowledgeDocument.count({ where: { tenantId } }),
    prisma.tenantAction.count({
      where: { tenantId, enabled: true, key: { in: AVAILABLE_ACTIONS.map((a) => a.key) } },
    }),
    prisma.whatsappInstance.findUnique({ where: { tenantId }, select: { status: true } }),
  ]);

  return [
    { label: "Persona configurada", ok: Boolean(agentWithPrompt), href: "/agentes" },
    { label: "Base de conhecimento", ok: docs > 0, detail: `${docs} doc(s)`, href: "/agentes" },
    { label: "Ações ativas", ok: actions > 0, detail: `${actions} ativa(s)`, href: "/agentes" },
    {
      label: "WhatsApp conectado",
      ok: wa?.status === "connected",
      detail: wa?.status ?? "disconnected",
      href: "/whatsapp",
    },
  ];
}
