import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { isEmojiOnly } from "@/lib/emoji";
import { rateLimit } from "@/lib/rate-limit";
import { getWhatsAppProvider } from "@/modules/whatsapp";
import {
  appendMessage,
  getOrCreateConversation,
} from "@/modules/agent-engine/conversation";
import { runAgentTurn, resolveAgent } from "@/modules/agent-engine/orchestrator";
import { addLeadToHandoffGroup } from "@/modules/agent-engine/handoff";
import { transcribeAudio } from "@/modules/ai/transcribe";
import { speakReply } from "@/modules/voice/reply";

/**
 * Segredo compartilhado com a Evolution API, enviado por ela em todo webhook.
 *
 * Sem isto, o `instanceExternalId` do corpo era a única "identidade" — e
 * identificador não é credencial: quem descobrisse o id de uma instância
 * injetava mensagem em qualquer conversa, disparava as ferramentas do agente
 * (agendamento real, espelhado no Google Agenda) e queimava a cota de LLM do
 * tenant. O webhook do Stripe, ao lado, sempre validou assinatura; este não.
 *
 * Configure `WHATSAPP_WEBHOOK_SECRET` aqui e o mesmo valor no header do webhook
 * na Evolution (`x-webhook-secret`).
 */
const SECRET_HEADER = "x-webhook-secret";

function isAuthorized(req: Request): boolean {
  const expected = process.env.WHATSAPP_WEBHOOK_SECRET;

  // Falha FECHADA: sem segredo configurado, ninguém entra. O contrário faria um
  // deploy sem a variável reabrir o endpoint em silêncio, que é exatamente o
  // modo de falha que esta checagem existe para evitar.
  if (!expected) {
    console.error(
      "[whatsapp webhook] WHATSAPP_WEBHOOK_SECRET não configurada — recusando. " +
        "Gere uma com: openssl rand -base64 32",
    );
    return false;
  }

  const received = req.headers.get(SECRET_HEADER) ?? "";
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  // Comparação em tempo constante, mesmo padrão de `lib/impersonation`: o
  // tamanho é checado antes porque timingSafeEqual lança com buffers desiguais.
  return a.length === b.length && timingSafeEqual(a, b);
}

// Recebe mensagens do WhatsApp (Evolution API) e responde com o agente.
export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }

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

  /**
   * Teto por instância: cada mensagem processada custa uma chamada paga de LLM.
   * O segredo acima já barra quem é de fora; este limite contém o caso de um
   * segredo vazado ou de a própria Evolution entrar em laço de reentrega.
   *
   * Responde 200 (e não 429) de propósito: para a Evolution, 429 é falha e ela
   * reentrega — o que dobraria justamente o volume que queremos conter.
   */
  const burst = await rateLimit("whatsapp:instance", incoming.instanceExternalId, 120, 60);
  if (!burst.allowed) {
    console.warn(
      `[whatsapp webhook] limite de taxa atingido na instância ${incoming.instanceExternalId}`,
    );
    return NextResponse.json({ ignored: "limite de taxa" });
  }

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

  // Mensagens enviadas pela PRÓPRIA instância (fromMe). O app já grava tudo que
  // envia — resposta do agente (via runAgentTurn), resposta manual do painel e
  // follow-up do worker — e a Evolution reentrega cada envio como fromMe. Sem
  // dedup, tudo duplicaria. Duas origens possíveis, então:
  //   1. Eco do app → ignorar. Dedup por key.id anexado em `whatsappMessageId`;
  //      se ainda não deu tempo de anexar (janela entre enviar e atualizar),
  //      fallback por conteúdo recente da IA na mesma conversa.
  //   2. O dono respondeu pelo CELULAR → entra no histórico como resposta
  //      humana (sentBy "human"), pausa o agente, igual resposta pelo painel.
  if (incoming.isFromMe) {
    // Grupo e áudio de ida: nada a registrar (não são respostas de atendimento).
    if (incoming.isGroup || incoming.hasAudio || incoming.isReaction) {
      return NextResponse.json({ ok: true, silent: "fromMe ignorado" });
    }

    // Eco do app: o key.id já identifica sem tocar em lead/conversa.
    if (incoming.messageKeyId) {
      const echo = await prisma.message.findUnique({
        where: { whatsappMessageId: incoming.messageKeyId },
        select: { id: true },
      });
      if (echo) return NextResponse.json({ ok: true, silent: "fromMe eco" });
    }

    const { conversation } = await getOrCreateConversation(
      tenantId,
      incoming.fromPhone,
      incoming.fromName,
    );

    // Fallback: eco cujo key.id ainda não foi anexado (corrida entre enviar e
    // atualizar) — o dono digitar a MESMA frase que a IA acabou de mandar é
    // praticamente impossível.
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
    if (recentEcho) return NextResponse.json({ ok: true, silent: "fromMe eco" });

    await appendMessage(conversation.id, "assistant", incoming.text, "human", incoming.messageKeyId);
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { needsHuman: false, agentPaused: true },
    });
    return NextResponse.json({ ok: true, silent: "manual pelo whatsapp" });
  }

  const { lead, conversation } = await getOrCreateConversation(
    tenantId,
    incoming.fromPhone,
    incoming.fromName,
  );

  // Reação (emoji sobreposta a uma mensagem): não é uma mensagem do cliente —
  // não entra no histórico e não dispara turno. Com a opção "Encerrar conversa
  // com emoji" ligada, a reação encerra a conversa: pausa com o mesmo flag de
  // quando um humano assume (`agentPaused`), para o agente não responder por
  // cima na próxima mensagem.
  if (incoming.isReaction) {
    if (agent?.stopOnEmoji) {
      await prisma.conversation
        .update({ where: { id: conversation.id }, data: { agentPaused: true, needsHuman: true } })
        .catch(() => {});
      // "Transferir para humano" pode estar configurada para também colocar o
      // contato num grupo do WhatsApp — mesmo caminho da tool `handoff_human`,
      // porque para o cliente isso É uma transferência para atendimento.
      await addLeadToHandoffGroup(tenantId, agent.id, incoming.fromPhone, {
        isTest: lead.isTest,
      });
    }
    return NextResponse.json({ ok: true, silent: "reaction" });
  }

  // Opção "parar com emoji": cliente manda só um emoji e a conversa encerra.
  // Pausa com o mesmo flag de quando um humano assume (`agentPaused`): o
  // `runAgentTurn` ainda registra a mensagem, mas fica em silêncio. O dono
  // devolve a conversa em /conversas para o agente voltar a atender.
  if (agent?.stopOnEmoji && isEmojiOnly(userMessage)) {
    await prisma.conversation
      .update({ where: { id: conversation.id }, data: { agentPaused: true, needsHuman: true } })
      .catch(() => {});
    await addLeadToHandoffGroup(tenantId, agent.id, incoming.fromPhone, {
      isTest: lead.isTest,
    });
  }

  try {
    const { reply, status, replyMessageId } = await runAgentTurn({
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

    // Resposta em voz: só quando o contato mandou áudio e a conta gravou uma
    // voz (ver modules/voice/reply.ts). Qualquer "não" aqui — opção desligada,
    // sem voz, texto longo, Fish Audio fora do ar — cai no envio em texto logo
    // abaixo. Falar é um upgrade da entrega; ficar sem resposta não é opção.
    let keyId: string | null = null;
    // Separado do `keyId`: o provedor pode entregar o áudio e mesmo assim
    // devolver `null` (a interface permite — nem todo provedor expõe o key.id).
    // Decidir o fallback pelo keyId mandaria a MESMA resposta duas vezes, uma
    // falada e outra escrita.
    let sent = false;

    const spoken = await speakReply({
      text: reply,
      settings: { speakReplies: agent?.speakReplies ?? false, voiceId: agent?.voiceId ?? null },
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
        // O áudio saiu da Fish Audio mas o WhatsApp recusou. Cai para texto em
        // vez de perder a resposta que o LLM já produziu (e já cobrou).
        console.error("[whatsapp webhook] falha ao enviar áudio, enviando texto", err);
      }
    }

    if (!sent) {
      keyId = await provider.sendMessage(incoming.instanceExternalId, incoming.fromPhone, reply);
    }

    // Anexa o key.id à resposta que acabamos de gravar: quando a Evolution
    // reentregar essa mensagem como fromMe, o webhook reconhece como eco e
    // não duplica.
    if (keyId && replyMessageId) {
      await prisma.message
        .update({ where: { id: replyMessageId }, data: { whatsappMessageId: keyId } })
        .catch(() => {});
    }
  } catch (err) {
    console.error("[whatsapp webhook] falha ao processar turno", err);
    return NextResponse.json({ error: "falha" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
