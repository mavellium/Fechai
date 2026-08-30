"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { strongPassword } from "@/lib/password-schema";
import { createFeedback } from "@/modules/feedback/service";
import { ensureAffiliate } from "@/modules/affiliates/service";
import { getAccountRoles } from "@/modules/affiliates/roles";

const schema = z.object({
  message: z.string().trim().min(3, "Escreva um pouco mais"),
  rating: z.coerce.number().int().min(1).max(5).optional(),
});

type Result = { ok: boolean; error?: string; info?: string };

export async function submitFeedback(_prev: Result | null, formData: FormData): Promise<Result> {
  const { tenantId } = await requireTenant();
  const raw = {
    message: formData.get("message"),
    rating: formData.get("rating") || undefined,
  };
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }
  await createFeedback(tenantId, parsed.data.message, parsed.data.rating ?? null);
  return { ok: true, info: "Obrigado pelo feedback!" };
}

const profileSchema = z.object({
  name: z.string().trim().min(1, "Informe seu nome"),
});

export async function updateProfile(_prev: Result | null, formData: FormData): Promise<Result> {
  const { session } = await requireTenant();
  const parsed = profileSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { name: parsed.data.name },
  });
  // O nome exibido na sessão (JWT) só atualiza no próximo login — a página
  // relê do banco, então isso mantém o Server Component em dia.
  revalidatePath("/configuracoes");
  return { ok: true, info: "Perfil atualizado." };
}

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, "Informe a senha atual"),
    // Mesma política do cadastro (lib/password): senha NOVA nasce sob a regra
    // nova, mesmo que a atual seja de antes dela.
    newPassword: strongPassword(),
    confirmPassword: z.string().min(1, "Confirme a nova senha"),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "As senhas não conferem",
    path: ["confirmPassword"],
  });

export async function changePassword(_prev: Result | null, formData: FormData): Promise<Result> {
  const { session } = await requireTenant();
  const parsed = passwordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user?.passwordHash) {
    return { ok: false, error: "Esta conta não tem senha configurada." };
  }

  const matches = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
  if (!matches) return { ok: false, error: "Senha atual incorreta." };

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
  return { ok: true, info: "Senha alterada com sucesso." };
}

/**
 * Liga/desliga os papéis da conta (usar o produto · ser afiliado).
 *
 * Os dois moram em lugares diferentes — `User.usesProduct` e a existência de
 * `Affiliate` — e esta ação é o único ponto que escreve os dois juntos, para
 * não haver duas telas com regras divergentes.
 *
 * Regras:
 *  - **Pelo menos um papel ativo.** Uma conta sem nenhum não teria painel; o
 *    pedido é recusado em vez de deixar a pessoa se trancar para fora.
 *  - **Sair do programa NÃO apaga o cadastro de afiliado.** O registro (código,
 *    indicações, comissões) fica; só some do menu. Apagar destruiria histórico
 *    de dinheiro e mataria links já divulgados — reativar devolve tudo, com o
 *    mesmo código.
 */
export async function updateAccountRoles(
  _prev: Result | null,
  formData: FormData,
): Promise<Result> {
  const { session } = await requireTenant();

  // Checkbox ausente no FormData = desmarcado.
  const wantsProduct = formData.get("usesProduct") === "on";
  const wantsAffiliate = formData.get("isAffiliate") === "on";

  if (!wantsProduct && !wantsAffiliate) {
    return {
      ok: false,
      error: "Escolha pelo menos uma opção — sua conta precisa de ao menos um uso.",
    };
  }

  const current = await getAccountRoles(session.user.id);

  if (wantsProduct !== current.usesProduct) {
    await prisma.user.update({
      where: { id: session.user.id },
      data: { usesProduct: wantsProduct },
    });
  }

  // Entrar no programa cria o cadastro (idempotente, mantém o código de quem
  // já teve um). Sair só desmarca — ver a nota acima sobre não apagar.
  if (wantsAffiliate && !current.isAffiliate) {
    await ensureAffiliate(session.user.id);
  } else if (!wantsAffiliate && current.isAffiliate) {
    // `OPTED_OUT`, e não `SUSPENDED`: saída voluntária não é punição, e a tela
    // de suspensão diz "fale com o suporte" — mensagem errada para quem
    // apertou o botão por vontade própria.
    await prisma.affiliate.update({
      where: { userId: session.user.id },
      data: { status: "OPTED_OUT" },
    });
  } else if (wantsAffiliate && current.isAffiliate) {
    // Volta ao programa com o MESMO código. Só reabre saída voluntária —
    // bloqueio do admin (`SUSPENDED`) não se desfaz por aqui.
    await prisma.affiliate.updateMany({
      where: { userId: session.user.id, status: "OPTED_OUT" },
      data: { status: "ACTIVE" },
    });
  }

  // O menu vive no layout do painel: revalidar só /configuracoes deixaria a
  // navegação desatualizada até a próxima navegação cheia.
  revalidatePath("/", "layout");
  return { ok: true, info: "Preferências atualizadas." };
}
