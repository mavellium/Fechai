"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { createFeedback } from "@/modules/feedback/service";

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
    newPassword: z.string().min(6, "Mínimo de 6 caracteres"),
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
