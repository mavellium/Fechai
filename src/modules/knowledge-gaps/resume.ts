import { prisma } from "@/lib/prisma";
import { appendMessage } from "@/modules/agent-engine/conversation";
import { isPhoneBlocked } from "@/modules/whatsapp/blocklist";
import { getWhatsAppProviderForInstance } from "@/modules/whatsapp/meta-config";
import {
  channelProvider,
  isReadyChannel,
  listWhatsappChannels,
  pickWhatsappChannel,
} from "@/modules/whatsapp/instances";

/**
 * Até quando dá para voltar a quem perguntou. Na Meta é regra dela: fora das
 * 24h abertas pelo contato só sai template aprovado. No número por QR não há
 * regra, mas uma resposta semanas depois já não é "já te retorno" — vira
 * mensagem de desconhecido, que é o que leva o número da clínica ao bloqueio.
 */
export const RESUME_WINDOW_HOURS = { meta: 24, evolution: 7 * 24 } as const;

export type ResumeSummary = {
  sent: number;
  skipped: number;
  failed: number;
  /** Nada foi tentado (WhatsApp desconectado): os contatos continuam pendentes. */
  blocked?: string;
  /**
   * Com as duas conexões: contatos cujo número está fora do ar enquanto o outro
   * atende. Continuam pendentes — voltar a eles pelo outro número seria primeiro
   * contato. Ausente quando não há nenhum.
   */
  waiting?: number;
};

/**
 * Manda a resposta aprovada a quem ficou esperando. Só a pedido de quem
 * aprovou — nunca sozinho — e **nunca reenvia**: cada contato é reivindicado
 * (`resumeStatus` null → sending) antes do envio, e um envio sem confirmação
 * vira `failed`, não fila de nova tentativa. O WhatsApp pode ter entregue
 * antes do erro, e a mesma resposta duas vezes é pior do que nenhuma.
 *
 * Fica de fora (`skipped`, com o motivo na tela) quem: é teste, está
 * bloqueado, pediu para parar, já recebeu resposta de uma pessoa na conversa
 * depois da pergunta, ou saiu da janela de envio.
 *
 * Sai como `sentBy: "human"` — foi a equipe que escreveu, não gasta cota — e
 * NÃO pausa o agente, ao contrário da resposta manual: se o contato responder,
 * o agente continua a conversa, agora com a resposta na base.
 */
export async function resumeGapContacts(tenantId: string, gapId: string, message: string, now = new Date()): Promise<ResumeSummary> {
  const summary: ResumeSummary = { sent: 0, skipped: 0, failed: 0 };
  const text = message.trim();
  if (!text) return summary;

  const occurrences = await prisma.knowledgeGapOccurrence.findMany({
    where: { gapId, tenantId, resumeStatus: null },
    select: {
      id: true,
      askedAt: true,
      conversation: {
        select: {
          id: true, isTest: true, lastInboundAt: true, followUpReason: true, whatsappProvider: true,
          lead: { select: { phone: true, isTest: true } },
        },
      },
    },
  });
  if (!occurrences.length) return summary;

  // Só as conexões de pé E utilizáveis (a Meta sem token legível não envia).
  const usable = (await listWhatsappChannels(tenantId)).filter(
    (c) => isReadyChannel(c) && getWhatsAppProviderForInstance(c).isConfigured(),
  );
  if (!usable.length) {
    return { ...summary, blocked: "O WhatsApp não está conectado: ninguém foi retomado. Tente de novo depois de reconectar." };
  }
  let waiting = 0;

  for (const occ of occurrences) {
    const c = occ.conversation;
    // Cada contato volta pelo número em que perguntou. `null` = esse número
    // está fora do ar e o outro não o substitui (primeiro contato).
    const instance = pickWhatsappChannel(usable, c.whatsappProvider);
    const isMeta = instance ? channelProvider(instance) === "meta" : c.whatsappProvider === "meta";
    const windowMs = (isMeta ? RESUME_WINDOW_HOURS.meta : RESUME_WINDOW_HOURS.evolution) * 3_600_000;
    let skip: string | null = null;
    if (c.isTest || c.lead.isTest) skip = "Conversa de teste.";
    else if (c.followUpReason === "stop") skip = "O contato pediu para não receber mensagens.";
    else if (!c.lastInboundAt || now.getTime() - c.lastInboundAt.getTime() > windowMs) {
      skip = isMeta
        ? "Passou da janela de 24h da Meta desde a última mensagem do contato."
        : "A última mensagem do contato tem mais de 7 dias.";
    } else if (await isPhoneBlocked(tenantId, c.lead.phone)) skip = "Número bloqueado na conta.";
    else if (await prisma.message.count({
      where: { conversationId: c.id, role: "assistant", sentBy: "human", createdAt: { gt: occ.askedAt } },
    })) skip = "A equipe já respondeu esse contato na conversa.";

    if (skip) {
      const res = await prisma.knowledgeGapOccurrence.updateMany({
        where: { id: occ.id, resumeStatus: null },
        data: { resumeStatus: "skipped", resumeNote: skip },
      });
      if (res.count) summary.skipped++;
      continue;
    }

    // O número deste contato está fora do ar: fica pendente, sem reivindicar.
    if (!instance?.externalId) {
      waiting++;
      continue;
    }

    const claim = await prisma.knowledgeGapOccurrence.updateMany({
      where: { id: occ.id, resumeStatus: null },
      data: { resumeStatus: "sending" },
    });
    if (!claim.count) continue;

    let keyId: string | null;
    try {
      keyId = await getWhatsAppProviderForInstance(instance).sendMessage(instance.externalId, c.lead.phone, text);
    } catch (err) {
      console.error("[knowledge-gaps] retomada sem confirmação", occ.id, err);
      await prisma.knowledgeGapOccurrence.update({
        where: { id: occ.id },
        data: {
          resumeStatus: "failed",
          resumeNote: "Envio sem confirmação. Pode ter chegado — confira a conversa antes de responder à mão.",
        },
      });
      summary.failed++;
      continue;
    }

    // Registrar no histórico nunca desfaz o envio: se falhar, a tela ainda
    // mostra "enviada" e o eco do webhook traz a mensagem de volta.
    await appendMessage(c.id, "assistant", text, "human", keyId ?? undefined).catch((err) =>
      console.error("[knowledge-gaps] retomada enviada, mas não registrada na conversa", occ.id, err),
    );
    await prisma.knowledgeGapOccurrence.update({
      where: { id: occ.id },
      data: { resumeStatus: "sent", resumeNote: null, resumedAt: new Date() },
    });
    summary.sent++;
  }
  if (waiting) summary.waiting = waiting;
  return summary;
}
