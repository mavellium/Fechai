import { prisma } from "@/lib/prisma";
import { speakReply } from "@/modules/voice/reply";
import { storeVoiceMessage } from "@/modules/voice/storage";
import type { WhatsAppProvider } from "./provider";

/** Entrega uma resposta já gerada pelo agente, tanto no webhook quanto na retomada. */
export async function sendAgentReply(input: {
  tenantId: string;
  conversationId: string;
  phone: string;
  externalId: string;
  provider: WhatsAppProvider;
  reply: string;
  replyMessageId?: string;
  incomingWasAudio: boolean;
  agent: {
    speakReplies: boolean;
    voiceId: string | null;
    speechBlocklist: string | null;
    voiceStyle: string | null;
  } | null;
}): Promise<void> {
  const spoken = await speakReply({
    text: input.reply,
    settings: {
      speakReplies: input.agent?.speakReplies ?? false,
      voiceId: input.agent?.voiceId ?? null,
      speechBlocklist: input.agent?.speechBlocklist ?? "",
      voiceStyle: input.agent?.voiceStyle ?? null,
    },
    incomingWasAudio: input.incomingWasAudio,
  });

  let keyId: string | null = null;
  let sentAudio = false;
  if (spoken.spoken) {
    try {
      keyId = await input.provider.sendAudio(input.externalId, input.phone, {
        base64: spoken.audio.toString("base64"),
        mime: spoken.mime,
      });
      sentAudio = true;
    } catch (error) {
      console.error("[whatsapp] falha ao enviar áudio do agente; tentando texto", error);
    }
  }
  if (!sentAudio) {
    keyId = await input.provider.sendMessage(input.externalId, input.phone, input.reply);
  }

  const audioUrl = sentAudio && spoken.spoken
    ? await storeVoiceMessage({
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        audio: spoken.audio,
        mime: spoken.mime,
      })
    : null;
  if (input.replyMessageId && (keyId || audioUrl)) {
    await prisma.message.update({
      where: { id: input.replyMessageId },
      data: { whatsappMessageId: keyId, audioUrl },
    }).catch(() => {});
  }
}
