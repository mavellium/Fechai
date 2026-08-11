"use server";

import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { sendManualReply } from "@/modules/agent-engine/conversation";

type Result = { ok: boolean; error?: string };

/**
 * Tira a conversa da fila "precisa de você".
 *
 * Fecha o beco sem saída apontado na revisão anterior: o agente marcava
 * `needsHuman` e não havia nada a fazer na tela — a conversa ficava na fila para
 * sempre, mesmo depois de a pessoa atender pelo WhatsApp.
 *
 * `updateMany` com `tenantId` no `where` (e não `update` por id): garante que um
 * id de outra conta não seja alterado, mesmo com a action chamada por POST
 * direto, fora da interface.
 */
export async function resolveConversation(id: string): Promise<Result> {
  const { tenantId } = await requireTenant();

  const res = await prisma.conversation.updateMany({
    where: { id, tenantId },
    data: { needsHuman: false },
  });

  if (res.count === 0) return { ok: false, error: "Conversa não encontrada." };

  revalidatePath("/conversas");
  revalidatePath("/inicio");
  return { ok: true };
}

/**
 * Devolve a conversa para a fila (desfaz o "resolvida" clicado por engano) e
 * devolve o atendimento automático para o agente, se um humano tinha assumido
 * (`sendManualMessage`) — reabrir uma conversa e deixar a IA muda de novo
 * seria o mesmo beco sem saída que essa tela já resolveu uma vez.
 */
export async function reopenConversation(id: string): Promise<Result> {
  const { tenantId } = await requireTenant();

  const res = await prisma.conversation.updateMany({
    where: { id, tenantId },
    data: { needsHuman: true, agentPaused: false },
  });

  if (res.count === 0) return { ok: false, error: "Conversa não encontrada." };

  revalidatePath("/conversas");
  revalidatePath("/inicio");
  return { ok: true };
}

/**
 * Responder manualmente pelo painel — dono da conta digitando no lugar do
 * agente, a partir de uma conversa já aberta. `sendManualReply`
 * (`agent-engine/conversation.ts`) decide envio real vs. simulação de teste,
 * grava com `sentBy: "human"` e pausa o agente nesta conversa; mesmo núcleo
 * usado por `sendMessageToContact` (`contatos/actions.ts`), a partir de um lead.
 */
export async function sendManualMessage(conversationId: string, text: string): Promise<Result> {
  const { tenantId } = await requireTenant();
  const res = await sendManualReply(tenantId, conversationId, text);
  if (!res.ok) return res;

  revalidatePath("/conversas");
  revalidatePath("/inicio");
  return { ok: true };
}

/**
 * Pausa/retoma o agente NESTA conversa (por conversa, não pelo agente inteiro).
 *
 * É a resposta ao "como faço ele voltar a responder?": a reação/emoji de parada
 * liga `agentPaused` (e `needsHuman`) no webhook, e não havia nenhum botão que
 * desligasse os dois de uma vez — o "Marcar como resolvida" só limpava o
 * `needsHuman` e a IA continuava muda. `paused=false` limpa os dois juntos: a
 * conversa sai da fila "precisa de você" e o agente volta a responder.
 */
export async function setConversationAgentPaused(id: string, paused: boolean): Promise<Result> {
  const { tenantId } = await requireTenant();

  const res = await prisma.conversation.updateMany({
    where: { id, tenantId },
    data: paused ? { agentPaused: true } : { agentPaused: false, needsHuman: false },
  });

  if (res.count === 0) return { ok: false, error: "Conversa não encontrada." };

  revalidatePath("/conversas");
  revalidatePath("/inicio");
  return { ok: true };
}

/**
 * Excluir um chat de teste (sandbox) em definitivo: a conversa, as mensagens e
 * o lead de teste vão junto (cascade). Só conversas `isTest: true` da própria
 * conta passam por aqui — um id de conversa real retorna erro, nunca apaga.
 */
export async function deleteTestConversation(id: string): Promise<Result> {
  const { tenantId } = await requireTenant();

  const conv = await prisma.conversation.findFirst({
    where: { id, tenantId, isTest: true, lead: { isTest: true } },
    select: { id: true, leadId: true },
  });
  if (!conv) return { ok: false, error: "Conversa de teste não encontrada." };

  await prisma.$transaction([
    prisma.message.deleteMany({ where: { conversationId: conv.id } }),
    prisma.conversation.delete({ where: { id: conv.id } }),
    prisma.lead.delete({ where: { id: conv.leadId } }),
  ]);

  revalidatePath("/conversas");
  revalidatePath("/inicio");
  return { ok: true };
}
