import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import {
  getOrCreateConversation,
  resetTestConversation,
} from "@/modules/agent-engine/conversation";
import { runAgentTurn } from "@/modules/agent-engine/orchestrator";

/**
 * Telefone sintético do chat de teste. Um por agente (`sandbox:<id>`) para
 * testar dois agentes não misturar o histórico dos dois no mesmo contexto.
 * Sem agente escolhido, cai no valor legado — é a linha que as contas antigas
 * já têm no banco.
 */
function sandboxPhone(agentId?: string) {
  return agentId ? `sandbox:${agentId}` : "sandbox";
}

const schema = z.object({
  message: z.string().trim().min(1),
  agentId: z.string().trim().min(1).optional(),
});

/** Garante que o agente é da conta antes de usá-lo (id vem do cliente). */
async function ownedAgentId(tenantId: string, agentId?: string) {
  if (!agentId) return undefined;
  const agent = await prisma.agent.findFirst({
    where: { id: agentId, tenantId, archived: false },
    select: { id: true },
  });
  return agent?.id;
}

// Chat de teste no dashboard: roda o mesmo motor sem WhatsApp real.
// O lead/conversa criados aqui nascem com `isTest`, então não entram em
// Contatos, Conversas nem nos relatórios (antes o teste virava lead de verdade).
export async function POST(req: Request) {
  const { tenantId } = await requireTenant();
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Mensagem vazia" }, { status: 400 });
  }

  const agentId = await ownedAgentId(tenantId, parsed.data.agentId);
  const { lead, conversation } = await getOrCreateConversation(
    tenantId,
    sandboxPhone(agentId),
    "Chat de teste",
    { isTest: true },
  );

  const { reply, toolsUsed, status } = await runAgentTurn({
    tenantId,
    conversationId: conversation.id,
    leadId: lead.id,
    userMessage: parsed.data.message,
    agentId,
  });

  return NextResponse.json({ reply, toolsUsed, status });
}

/** Limpa o histórico do teste — o botão "recomeçar" do sandbox. */
export async function DELETE(req: Request) {
  const { tenantId } = await requireTenant();
  const agentId = await ownedAgentId(
    tenantId,
    new URL(req.url).searchParams.get("agentId") ?? undefined,
  );
  await resetTestConversation(tenantId, sandboxPhone(agentId));
  return NextResponse.json({ ok: true });
}
