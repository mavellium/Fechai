import { prisma } from "@/lib/prisma";
import { recordReportEvent } from "@/modules/reports/events";
import { rateLimit } from "@/lib/rate-limit";
import {
  appendMessage,
  getOrCreateConversation,
} from "@/modules/agent-engine/conversation";
import { notifyHandoffGroup } from "@/modules/agent-engine/handoff";
import {
  resolveAgent,
  runAgentTurn,
} from "@/modules/agent-engine/orchestrator";
import { transcribeAudio } from "@/modules/ai/transcribe";
import { speakReply } from "@/modules/voice/reply";
import { storeVoiceMessage } from "@/modules/voice/storage";
import { audioDurationSeconds, UNTRANSCRIBED_AUDIO } from "@/modules/voice/received-audio";
import { isPhoneBlocked } from "./blocklist";
import type { IncomingMessage, WhatsAppProvider } from "./provider";
import { shouldPauseAgentForReaction } from "./reactions";

export type IncomingWebhookResult = {
  body: Record<string, unknown>;
  status?: number;
};
const ok = (body: Record<string, unknown>): IncomingWebhookResult => ({ body });

async function receiveAudio(input: {
  incoming: IncomingMessage;
  provider: WhatsAppProvider;
  tenantId: string;
  conversationId: string;
  transcribe: boolean;
}): Promise<{ audioUrl: string | null; transcript: string | null; seconds: number | null }> {
  const { incoming, provider, tenantId, conversationId } = input;
  // A Evolution já informa a duração; a Meta não, e ela sai do arquivo baixado.
  let seconds = incoming.audioSeconds ?? null;
  const mediaKey = incoming.mediaId ?? incoming.messageKeyId;
  if (!mediaKey) return { audioUrl: null, transcript: null, seconds };

  let audioUrl: string | null = null;
  try {
    const { base64, mime } = await provider.getMediaAsBase64(
      incoming.instanceExternalId,
      mediaKey,
    );
    const audio = Buffer.from(base64, "base64");
    if (audio.length === 0) throw new Error("áudio vazio");
    seconds ??= audioDurationSeconds(audio);
    audioUrl = await storeVoiceMessage({
      tenantId,
      conversationId,
      audio,
      mime,
    });
    const transcript = input.transcribe
      ? await transcribeAudio(base64, mime)
      : null;
    return { audioUrl, transcript, seconds };
  } catch (err) {
    console.error("[whatsapp webhook] falha ao processar áudio", err);
    return { audioUrl, transcript: null, seconds };
  }
}

/** Fluxo comum depois que cada provedor autenticou e converteu seu webhook. */
export async function processIncomingWhatsapp(
  incoming: IncomingMessage,
  provider: WhatsAppProvider,
): Promise<IncomingWebhookResult> {
  const instance = await prisma.whatsappInstance.findFirst({
    where: { externalId: incoming.instanceExternalId, provider: provider.name },
    select: {
      tenantId: true,
      status: true,
      tenant: { select: { whatsappIgnoreGroups: true } },
    },
  });
  if (!instance || (instance.status && instance.status !== "connected")) {
    return ok({ ignored: "instância desconhecida ou desconectada" });
  }

  if (incoming.isGroup && instance.tenant?.whatsappIgnoreGroups)
    return ok({ ignored: "grupo" });
  const tenantId = instance.tenantId;
  if (
    !incoming.isGroup &&
    (await isPhoneBlocked(tenantId, incoming.fromPhone))
  ) {
    return ok({ ignored: "número bloqueado" });
  }

  // Reentrega de lote não consome a proteção de rajada dos eventos ainda novos.
  if (!incoming.isReaction && incoming.messageKeyId) {
    const existing = await prisma.message.findUnique({
      where: { whatsappMessageId: incoming.messageKeyId },
      select: { id: true },
    });
    if (existing) return ok({ ok: true, silent: "mensagem já registrada" });
  }

  const rateKey = `${provider.name}:${incoming.instanceExternalId}`;
  const burst = await rateLimit("whatsapp:instance", rateKey, 120, 60);
  if (!burst.allowed) {
    console.warn(
      `[whatsapp webhook] limite de taxa atingido na instância ${rateKey}`,
    );
    return provider.name === "meta"
      ? { body: { error: "limite de taxa" }, status: 429 }
      : ok({ ignored: "limite de taxa" });
  }

  const agent = await resolveAgent(tenantId);

  if (incoming.isFromMe) {
    if (incoming.isGroup) {
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
        await notifyHandoffGroup(tenantId, agent.id, conversation.id, {
          isTest: lead.isTest,
          reason: "Atendente assumiu a conversa por reação no WhatsApp.",
        });
        await recordReportEvent({ tenantId, conversationId: conversation.id, kind: "handoff",
          sourceKey: incoming.messageKeyId });
      }
      return ok({ ok: true, silent: "reação do atendente" });
    }

    // Respostas geradas pelo app também voltam como fromMe. Deduplicar antes
    // de baixar a mídia evita outro upload e outra bolha no histórico.
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
    if (!incoming.hasAudio) {
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
    }

    const received = incoming.hasAudio
      ? await receiveAudio({
          incoming,
          provider,
          tenantId,
          conversationId: conversation.id,
          transcribe: true,
        })
      : null;

    await appendMessage(
      conversation.id,
      "assistant",
      received?.transcript ?? (incoming.hasAudio ? UNTRANSCRIBED_AUDIO : incoming.text),
      "human",
      incoming.messageKeyId,
      received?.audioUrl,
      received?.seconds,
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
  if (incoming.messageKeyId) {
    const existing = await prisma.message.findUnique({
      where: { whatsappMessageId: incoming.messageKeyId },
      select: { id: true },
    });
    if (existing) return ok({ ok: true, silent: "mensagem já registrada" });
  }
  const received = incoming.hasAudio
    ? await receiveAudio({
        incoming,
        provider,
        tenantId,
        conversationId: conversation.id,
        transcribe: Boolean(agent?.listenAudio),
      })
    : null;
  const userMessage =
    received?.transcript ?? (incoming.hasAudio ? UNTRANSCRIBED_AUDIO : incoming.text);
  if (incoming.hasAudio && (!agent?.listenAudio || !received?.transcript)) {
    await appendMessage(
      conversation.id,
      "user",
      userMessage,
      undefined,
      incoming.messageKeyId,
      received?.audioUrl,
      received?.seconds,
    );
    return ok({
      ok: true,
      silent: agent?.listenAudio
        ? "áudio sem transcrição"
        : "áudio: opção desligada",
    });
  }
  try {
    const { reply, status, replyMessageId } = await runAgentTurn({
      tenantId,
      conversationId: conversation.id,
      leadId: lead.id,
      userMessage,
      incomingWasAudio: incoming.hasAudio,
      incomingAudioUrl: received?.audioUrl,
      incomingAudioSeconds: received?.seconds,
      incomingMessageKeyId: incoming.messageKeyId,
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
        keyId = await provider.sendAudio(
          incoming.instanceExternalId,
          incoming.fromPhone,
          {
            base64: spoken.audio.toString("base64"),
            mime: spoken.mime,
          },
        );
        sent = true;
      } catch (err) {
        console.error(
          "[whatsapp webhook] falha ao enviar áudio, enviando texto",
          err,
        );
      }
    }
    if (!sent) {
      keyId = await provider.sendMessage(
        incoming.instanceExternalId,
        incoming.fromPhone,
        reply,
      );
    }
    const audioUrl =
      sent && spoken.spoken
        ? await storeVoiceMessage({
            tenantId,
            conversationId: conversation.id,
            audio: spoken.audio,
            mime: spoken.mime,
          })
        : null;
    if (replyMessageId && (keyId || audioUrl)) {
      await prisma.message
        .update({
          where: { id: replyMessageId },
          data: { whatsappMessageId: keyId, audioUrl },
        })
        .catch(() => {});
    }
  } catch (err) {
    console.error("[whatsapp webhook] falha ao processar turno", err);
    return { body: { error: "falha" }, status: 500 };
  }

  return ok({ ok: true });
}
