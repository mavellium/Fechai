import { prisma } from "@/lib/prisma";
import { getWhatsAppProvider } from "@/modules/whatsapp";
import { storeVoiceMessage } from "@/modules/voice/storage";

/**
 * Encontra (ou cria) o lead + conversa de um telefone, dentro do tenant.
 * Sempre isolado por tenantId.
 *
 * `isTest` marca o que veio do chat de teste (sandbox). A marca fica no lead e
 * é espelhada na conversa para as telas filtrarem sem join — sem ela o sandbox
 * era contado como cliente real em Contatos, Conversas e Relatórios.
 */
export async function getOrCreateConversation(
  tenantId: string,
  phone: string,
  name?: string,
  options: { isTest?: boolean } = {},
) {
  const isTest = options.isTest ?? false;

  let lead = await prisma.lead.findFirst({
    where: { tenantId, phone },
    include: { conversation: true },
  });

  if (!lead) {
    lead = await prisma.lead.create({
      data: {
        tenantId,
        phone,
        name,
        isTest,
        conversation: { create: { tenantId, isTest } },
      },
      include: { conversation: true },
    });
  } else if (!lead.conversation) {
    const conversation = await prisma.conversation.create({
      data: { tenantId, leadId: lead.id, isTest: lead.isTest },
    });
    lead = { ...lead, conversation };
  } else if (isTest && !lead.isTest) {
    // Sandbox de contas antigas: o lead "sandbox" já existia sem a marca.
    // Corrigir na leitura evita depender de o backfill ter rodado.
    await prisma.$transaction([
      prisma.lead.update({ where: { id: lead.id }, data: { isTest: true } }),
      prisma.conversation.update({ where: { id: lead.conversation.id }, data: { isTest: true } }),
    ]);
    lead = { ...lead, isTest: true, conversation: { ...lead.conversation, isTest: true } };
  }

  return { lead, conversation: lead.conversation! };
}

/**
 * "Recomeçar" o chat de teste sem perder o histórico: em vez de apagar,
 * arquiva a conversa atual (sai do telefone canônico do sandbox, então o
 * próximo `getOrCreateConversation` não a encontra mais) e deixa um lead novo
 * nascer vazio na próxima mensagem. A arquivada continua no banco, visível em
 * Conversas (aba "Testes") — testar uma persona nova não pode custar o
 * histórico do teste anterior, mas também não pode vazar pro contexto do LLM
 * na próxima rodada.
 */
export async function startFreshTestConversation(tenantId: string, phone: string) {
  const lead = await prisma.lead.findFirst({ where: { tenantId, phone, isTest: true } });
  if (!lead) return;
  await prisma.lead.update({
    where: { id: lead.id },
    data: { phone: `${phone}:archived:${Date.now()}` },
  });
}

export async function appendMessage(
  conversationId: string,
  role: "user" | "assistant" | "system",
  content: string,
  /** Só relevante em `role: "assistant"` — quem gerou a resposta. Ver schema.prisma. */
  sentBy?: "agent" | "human",
  /** key.id no WhatsApp — só existe quando a mensagem foi enviada de verdade pela instância. */
  externalId?: string,
  /** URL do áudio na CDN, quando a mensagem foi entregue como voz. Ver schema. */
  audioUrl?: string | null,
) {
  const message = await prisma.message.create({
    data: {
      conversationId,
      role,
      content,
      sentBy,
      whatsappMessageId: externalId,
      audioUrl: audioUrl ?? null,
    },
  });
  if (role === "user") {
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { lastInboundAt: new Date() },
    });
  }
  return message;
}

export type SendManualReplyResult = { ok: true } | { ok: false; error: string };

/**
 * Núcleo de "um humano respondeu pelo painel" — compartilhado por
 * `conversas/actions.ts` (`sendManualMessage`, a partir de uma conversa já
 * aberta) e `contatos/actions.ts` (`sendMessageToContact`, a partir de um
 * lead). As duas telas faziam essa lógica em duplicado antes desta função
 * existir, cada uma só com metade do cuidado: nenhuma marcava `sentBy` nem
 * pausava o agente por conversa.
 *
 * Numa conversa real, envia de verdade pelo `WhatsAppProvider`; numa de teste
 * (sandbox), só grava — sem WhatsApp real envolvido. Sempre grava com
 * `sentBy: "human"` e liga `agentPaused`, para `runAgentTurn` não responder
 * por cima na machine seguinte.
 *
 * Com `audio`, a mensagem sai como **voz** (PTT) em vez de texto. O `text`
 * continua obrigatório e continua sendo o que fica no histórico: é ele que vai
 * para o contexto do LLM, para o resumo e para a busca (ver `Message.audioUrl`
 * no schema). Quem chama decide de onde esse texto vem — do que foi digitado
 * (texto→voz) ou da transcrição do que foi gravado.
 */
export async function sendManualReply(
  tenantId: string,
  conversationId: string,
  text: string,
  /** Manda como mensagem de voz. Sem isto, envio de texto normal. */
  audio?: { buffer: Buffer; mime: string },
): Promise<SendManualReplyResult> {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: "Escreva algo antes de enviar." };

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
    select: { id: true, isTest: true, lead: { select: { phone: true } } },
  });
  if (!conversation) return { ok: false, error: "Conversa não encontrada." };

  let externalId: string | null = null;
  if (!conversation.isTest) {
    const instance = await prisma.whatsappInstance.findUnique({
      where: { tenantId },
      select: { status: true, externalId: true },
    });
    if (!instance || instance.status !== "connected" || !instance.externalId) {
      return { ok: false, error: "O WhatsApp não está conectado. Conecte na tela WhatsApp antes de enviar." };
    }
    try {
      // Grava o key.id da mensagem que acabamos de enviar: o webhook reentrega
      // tudo que a instância manda como fromMe, e sem esse id a resposta
      // manual apareceria duas vezes no histórico.
      const provider = getWhatsAppProvider();
      externalId = audio
        ? await provider.sendAudio(instance.externalId, conversation.lead!.phone, {
            base64: audio.buffer.toString("base64"),
            mime: audio.mime,
          })
        : await provider.sendMessage(instance.externalId, conversation.lead!.phone, trimmed);
    } catch (err) {
      console.error("[agent-engine] falha ao enviar mensagem manual", err);
      return {
        ok: false,
        error: audio
          ? "Não foi possível enviar o áudio pelo WhatsApp. Tente de novo."
          : "Não foi possível enviar pelo WhatsApp. Tente de novo.",
      };
    }
  }

  // Só guarda na CDN DEPOIS do envio: se o WhatsApp recusar, não sobra arquivo
  // órfão de uma mensagem que nunca existiu. Falhar aqui não desfaz o envio —
  // a mensagem entra no histórico com o texto e sem player (ver storage.ts).
  let audioUrl: string | null = null;
  if (audio) {
    audioUrl = await storeVoiceMessage({
      tenantId,
      conversationId,
      audio: audio.buffer,
      mime: audio.mime,
    });
  }

  await appendMessage(
    conversationId,
    "assistant",
    trimmed,
    "human",
    externalId ?? undefined,
    audioUrl,
  );
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { needsHuman: false, agentPaused: true },
  });

  return { ok: true };
}

export async function getRecentMessages(conversationId: string, limit = 10) {
  const rows = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { role: true, content: true },
  });
  return rows.reverse();
}
