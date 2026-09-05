"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { payloadTooLarge } from "@/lib/rate-limit";
import { ensureAffiliate } from "@/modules/affiliates/service";

/**
 * Ações do painel do afiliado.
 *
 * Todas partem de `requireOwner()` e agem sobre o afiliado DO USUÁRIO logado —
 * nunca recebem `affiliateId` do cliente. Aceitar esse id pela borda deixaria
 * qualquer pessoa editar a chave Pix (e o destino do dinheiro) de outra.
 */

export type ActionState = { ok?: string; error?: string } | null;

/** Ativa o programa para quem criou a conta só como cliente. Idempotente. */
export async function activateAffiliate(): Promise<ActionState> {
  const session = await requireOwner();
  try {
    await ensureAffiliate(session.user.id);
    revalidatePath("/afiliado");
    return { ok: "Programa de afiliados ativado. Seu link já está pronto." };
  } catch (err) {
    console.error("[afiliado] falha ao ativar", err);
    return { error: "Não conseguimos ativar o programa agora. Tente de novo." };
  }
}

const payoutSchema = z.object({
  // Chave Pix aceita formatos muito diferentes (CPF, e-mail, telefone,
  // aleatória), então a validação aqui é de sanidade — quem confere de fato é
  // o banco na hora da transferência.
  payoutPixKey: z.string().trim().min(4, "Informe uma chave Pix válida.").max(80),
  payoutName: z.string().trim().min(2, "Informe o nome do titular.").max(120),
});

/** Salva os dados de recebimento (Pix) do afiliado. */
export async function savePayoutInfo(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // ActionState aqui é { ok?: string } — `ok` é a mensagem de sucesso, não um
  // booleano, então o erro vai sozinho.
  const tooLarge = payloadTooLarge(formData);
  if (tooLarge) return { error: tooLarge };

  const session = await requireOwner();

  const parsed = payoutSchema.safeParse({
    payoutPixKey: formData.get("payoutPixKey"),
    payoutName: formData.get("payoutName"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const affiliate = await prisma.affiliate.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });
  if (!affiliate) return { error: "Você ainda não faz parte do programa." };

  await prisma.affiliate.update({
    where: { id: affiliate.id },
    data: parsed.data,
  });

  revalidatePath("/afiliado");
  return { ok: "Dados de recebimento salvos." };
}
