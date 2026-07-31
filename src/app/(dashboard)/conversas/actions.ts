"use server";

import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/session";
import { prisma } from "@/lib/prisma";

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

/** Devolve a conversa para a fila (desfaz o "resolvida" clicado por engano). */
export async function reopenConversation(id: string): Promise<Result> {
  const { tenantId } = await requireTenant();

  const res = await prisma.conversation.updateMany({
    where: { id, tenantId },
    data: { needsHuman: true },
  });

  if (res.count === 0) return { ok: false, error: "Conversa não encontrada." };

  revalidatePath("/conversas");
  revalidatePath("/inicio");
  return { ok: true };
}
