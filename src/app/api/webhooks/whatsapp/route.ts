import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getWhatsAppProvider } from "@/modules/whatsapp";
import { getOrCreateConversation } from "@/modules/agent-engine/conversation";
import { runAgentTurn } from "@/modules/agent-engine/orchestrator";

// Recebe mensagens do WhatsApp (Evolution API) e responde com o agente.
export async function POST(req: Request) {
  const payload = await req.json().catch(() => null);
  const provider = getWhatsAppProvider();
  const incoming = provider.parseWebhook(payload);

  // 200 sempre que não for uma mensagem processável (evita reentrega infinita).
  if (!incoming) return NextResponse.json({ ignored: true });

  const instance = await prisma.whatsappInstance.findFirst({
    where: { externalId: incoming.instanceExternalId },
    select: { tenantId: true, tenant: { select: { whatsappIgnoreGroups: true } } },
  });
  if (!instance) return NextResponse.json({ ignored: "instância desconhecida" });

  // Config de grupos: se o tenant optou por ignorar, descarta em silêncio —
  // nem a mensagem entra como conversa/lead.
  if (incoming.isGroup && instance.tenant?.whatsappIgnoreGroups) {
    return NextResponse.json({ ignored: "grupo" });
  }

  const tenantId = instance.tenantId;
  const { lead, conversation } = await getOrCreateConversation(
    tenantId,
    incoming.fromPhone,
    incoming.fromName,
  );

  try {
    const { reply, status } = await runAgentTurn({
      tenantId,
      conversationId: conversation.id,
      leadId: lead.id,
      userMessage: incoming.text,
    });

    // Agente desligado (ou conta sem agente): a mensagem fica registrada em
    // Conversas marcada como "precisa de você", mas nada é respondido — é
    // exatamente o que a chave de desligar promete.
    if (status !== "ok" || !reply) {
      return NextResponse.json({ ok: true, silent: status });
    }

    await provider.sendMessage(incoming.instanceExternalId, incoming.fromPhone, reply);
  } catch (err) {
    console.error("[whatsapp webhook] falha ao processar turno", err);
    return NextResponse.json({ error: "falha" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
