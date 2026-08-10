import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isEmojiOnly } from "@/lib/emoji";
import { getWhatsAppProvider } from "@/modules/whatsapp";
import { getOrCreateConversation } from "@/modules/agent-engine/conversation";
import { runAgentTurn, resolveAgent } from "@/modules/agent-engine/orchestrator";
import { transcribeAudio } from "@/modules/ai/transcribe";

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
  const agent = await resolveAgent(tenantId);

  // Opção "ouvir áudio": mensagem de voz é transcrita e entra como texto.
  // Desligada (ou sem como transcrever), o áudio é descartado em silêncio —
  // o webhook sempre responde 200 para um áudio problemático, senão a Evolution
  // reentrega a mesma mensagem em loop (áudio ruim não melhora na reentrega).
  let userMessage = incoming.text;
  if (incoming.hasAudio) {
    if (!agent?.listenAudio) return NextResponse.json({ ignored: "áudio: opção desligada" });
    if (!incoming.messageKeyId) return NextResponse.json({ ignored: "áudio: sem chave" });
    try {
      const { base64, mime } = await provider.getMediaAsBase64(
        incoming.instanceExternalId,
        incoming.messageKeyId,
      );
      const transcript = await transcribeAudio(base64, mime);
      if (!transcript) return NextResponse.json({ ignored: "áudio: sem transcrição" });
      userMessage = transcript;
    } catch (err) {
      console.error("[whatsapp webhook] falha ao processar áudio", err);
      return NextResponse.json({ ignored: "áudio: falha" });
    }
  }

  const { lead, conversation } = await getOrCreateConversation(
    tenantId,
    incoming.fromPhone,
    incoming.fromName,
  );

  // Opção "parar com emoji": cliente manda só um emoji e a conversa encerra.
  // Pausa com o mesmo flag de quando um humano assume (`agentPaused`): o
  // `runAgentTurn` ainda registra a mensagem, mas fica em silêncio. O dono
  // devolve a conversa em /conversas para o agente voltar a atender.
  if (agent?.stopOnEmoji && isEmojiOnly(userMessage)) {
    await prisma.conversation
      .update({ where: { id: conversation.id }, data: { agentPaused: true, needsHuman: true } })
      .catch(() => {});
  }

  try {
    const { reply, status } = await runAgentTurn({
      tenantId,
      conversationId: conversation.id,
      leadId: lead.id,
      userMessage,
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
