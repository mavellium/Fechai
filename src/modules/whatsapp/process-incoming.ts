import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { appendMessage, getOrCreateConversation } from "@/modules/agent-engine/conversation";
import { addLeadToHandoffGroup } from "@/modules/agent-engine/handoff";
import { resolveAgent, runAgentTurn } from "@/modules/agent-engine/orchestrator";
import { transcribeAudio } from "@/modules/ai/transcribe";
import { speakReply } from "@/modules/voice/reply";
import { isPhoneBlocked } from "./blocklist";
import type { IncomingMessage, WhatsAppProvider } from "./provider";
import { shouldPauseAgentForReaction } from "./reactions";

export type IncomingWebhookResult = { body: Record<string, unknown>; status?: number };
const ok = (body: Record<string, unknown>): IncomingWebhookResult => ({ body });

/** Fluxo comum depois que cada provedor autenticou e converteu seu webhook. */
export async function processIncomingWhatsapp(
  incoming: IncomingMessage,
  provider: WhatsAppProvider,
): Promise<IncomingWebhookResult> {
  const instance = await prisma.whatsappInstance.findFirst({
    where: { externalId: incoming.instanceExternalId, provider: provider.name },
    select: { tenantId: true, status: true, tenant: { select: { whatsappIgnoreGroups: true } } },
  });
  if (!instance || (instance.status && instance.status !== "connected")) {
    return ok({ ignored: "instância desconhecida ou desconectada" });
  }

  const rateKey = `${provider.name}:${incoming.instanceExternalId}`;
  const burst = await rateLimit("whatsapp:instance", rateKey, 120, 60);
  if (!burst.allowed) {
    console.warn(`[whatsapp webhook] limite de taxa atingido na instância ${rateKey}`);
    return ok({ ignored: "limite de taxa" });
  }

  if (incoming.isGroup && instance.tenant?.whatsappIgnoreGroups) return ok({ ignored: "grupo" });
  const tenantId = instance.tenantId;
  if (!incoming.isGroup && (await isPhoneBlocked(tenantId, incoming.fromPhone))) {
    return ok({ ignored: "número bloqueado" });
  }

  const agent = await resolveAgent(tenantId);
  let userMessage = incoming.text;
  if (incoming.hasAudio) {
    if (!agent?.listenAudio) return ok({ ignored: "áudio: opção desligada" });
    const mediaKey = incoming.mediaId ?? incoming.messageKeyId;
    if (!mediaKey) return ok({ ignored: "áudio: sem chave" });
    try {
      const { base64, mime } = await provider.getMediaAsBase64(
        incoming.instanceExternalId,
        mediaKey,
      );
      const transcript = await transcribeAudio(base64, mime);
      if (!transcript) return ok({ ignored: "áudio: sem transcrição" });
      userMessage = transcript;
    } catch (err) {
      console.error("[whatsapp webhook] falha ao processar áudio", err);
      return ok({ ignored: "áudio: falha" });
    }
  }

  if (incoming.isFromMe) {
    if (incoming.isGroup || incoming.hasAudio) {
      return ok({ ok: true, silent: "fromMe ignorado" });
    }

    if (incoming.isReaction) {
      if (
        agent &&
        shouldPauseAgentForReaction({
          isReaction: incoming.isReaction,
          isFromMe: incoming.isFromMe,
          stopOnEmoji: agent.stopOnEmoji,
        })
      ) {
        const { lead, conversation } = await getOrCreateConversation(
          tenantId,
          incoming.fromPhone,
          incoming.fromName,
        );
        await prisma.conversation
          .update({
            where: { id: conversation.id },
            data: { agentPaused: true, needsHuman: true },
          })
          .catch(() => {});
        await addLeadToHandoffGroup(tenantId, agent.id, incoming.fromPhone, {
          isTest: lead.isTest,
        });
      }
      return ok({ ok: true, silent: "reação do atendente" });
    }

    if (incoming.messageKeyId) {
      const echo = await prisma.message.findUnique({
        where: { whatsappMessageId: incoming.messageKeyId },
        select: { id: true },
      });
      if (echo) return ok({ ok: true, silent: "fromMe eco" });
    }

    const { conversation } = await getOrCreateConversation(
      tenantId,
      incoming.fromPhone,
      incoming.fromName,
    );
    const recentEcho = await prisma.message.findFirst({
      where: {
        conversationId: conversation.id,
        role: "assistant",
        sentBy: "agent",
        content: incoming.text,
        createdAt: { gte: new Date(Date.now() - 15_000) },
      },
      select: { id: true },
    });
    if (recentEcho) return ok({ ok: true, silent: "fromMe eco" });

    await appendMessage(
      conversation.id,
      "assistant",
      incoming.text,
      "human",
      incoming.messageKeyId,
    );
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { needsHuman: false, agentPaused: true },
    });
    return ok({ ok: true, silent: "manual pelo whatsapp" });
  }

  if (incoming.isReaction) return ok({ ok: true, silent: "reação do cliente" });

  const { lead, conversation } = await getOrCreateConversation(
    tenantId,
    incoming.fromPhone,
    incoming.fromName,
  );
  try {
    const { reply, status, replyMessageId } = await runAgentTurn({
      tenantId,
      conversationId: conversation.id,
      leadId: lead.id,
      userMessage,
    });
    if (status !== "ok" || !reply) return ok({ ok: true, silent: status });

    let keyId: string | null = null;
    let sent = false;
    const spoken = await speakReply({
      text: reply,
      settings: {
        speakReplies: agent?.speakReplies ?? false,
        voiceId: agent?.voiceId ?? null,
        speechBlocklist: agent?.speechBlocklist ?? "",
        voiceStyle: agent?.voiceStyle ?? null,
      },
      incomingWasAudio: incoming.hasAudio,
    });

    if (spoken.spoken) {
      try {
        keyId = await provider.sendAudio(incoming.instanceExternalId, incoming.fromPhone, {
          base64: spoken.audio.toString("base64"),
          mime: spoken.mime,
        });
        sent = true;
      } catch (err) {
        console.error("[whatsapp webhook] falha ao enviar áudio, enviando texto", err);
      }
    }
    if (!sent) {
      keyId = await provider.sendMessage(incoming.instanceExternalId, incoming.fromPhone, reply);
    }
    if (keyId && replyMessageId) {
      await prisma.message
        .update({ where: { id: replyMessageId }, data: { whatsappMessageId: keyId } })
        .catch(() => {});
    }
  } catch (err) {
    console.error("[whatsapp webhook] falha ao processar turno", err);
    return { body: { error: "falha" }, status: 500 };
  }

  return ok({ ok: true });
}
