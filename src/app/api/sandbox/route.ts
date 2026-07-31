import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenant } from "@/lib/session";
import { getOrCreateConversation } from "@/modules/agent-engine/conversation";
import { runAgentTurn } from "@/modules/agent-engine/orchestrator";

const SANDBOX_PHONE = "sandbox";

const schema = z.object({ message: z.string().trim().min(1) });

// Chat de teste no dashboard: roda o mesmo motor sem WhatsApp real.
// Usa um lead/conversa fixos com telefone "sandbox" por tenant.
export async function POST(req: Request) {
  const { tenantId } = await requireTenant();
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Mensagem vazia" }, { status: 400 });
  }

  const { lead, conversation } = await getOrCreateConversation(tenantId, SANDBOX_PHONE, "Sandbox");
  const { reply, toolsUsed } = await runAgentTurn({
    tenantId,
    conversationId: conversation.id,
    leadId: lead.id,
    userMessage: parsed.data.message,
  });

  return NextResponse.json({ reply, toolsUsed });
}
