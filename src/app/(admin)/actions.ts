"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { PlanKey } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSuperadmin } from "@/lib/session";
import { setImpersonation, clearImpersonation } from "@/lib/impersonation";
import { setTenantStatus, adminSetPlan, adminSetUsageLimit, adminCreateAccount } from "@/modules/admin/service";
import { setFeedbackStatus, type FeedbackStatus } from "@/modules/feedback/service";
import { setActiveModelId } from "@/modules/ai";

export async function suspendTenant(tenantId: string, suspend: boolean) {
  await requireSuperadmin();
  await setTenantStatus(tenantId, suspend ? "suspended" : "active");
  revalidatePath("/admin/contas");
}

export async function changePlan(tenantId: string, planKey: PlanKey) {
  await requireSuperadmin();
  await adminSetPlan(tenantId, planKey);
  revalidatePath("/admin/contas");
}

/**
 * Altera os limites da conta (null = volta ao padrão do plano). São duas cotas
 * independentes: conversas/mês e o teto de respostas da IA por conversa.
 */
export async function setTenantUsageLimit(
  tenantId: string,
  limit: number | null,
  perConversationCap?: number | null,
) {
  await requireSuperadmin();
  await adminSetUsageLimit(tenantId, limit, perConversationCap);
  revalidatePath("/admin/contas");
}

export async function markFeedback(feedbackId: string, status: FeedbackStatus) {
  await requireSuperadmin();
  await setFeedbackStatus(feedbackId, status);
  revalidatePath("/admin/feedbacks");
}

export type CreateAccountResult = {
  ok: boolean;
  error?: string;
  /** Só volta quando o admin deixou a senha em branco. Mostrar UMA vez. */
  tempPassword?: string;
  email?: string;
};

const createAccountSchema = z.object({
  tenantName: z.string().trim().min(1, "Informe o nome da conta"),
  email: z.string().trim().toLowerCase().email("E-mail inválido"),
  // Vazio = gerar senha provisória.
  password: z
    .string()
    .refine((v) => v === "" || v.length >= 6, "A senha precisa ter ao menos 6 caracteres"),
  role: z.enum(["OWNER", "SUPERADMIN"]),
  planKey: z.enum(["FREE", "STARTER", "PRO", "BUSINESS"]),
});

/** Cria uma conta (qualquer papel, qualquer plano) pelo painel admin. */
export async function createAccount(
  _prev: CreateAccountResult | null,
  formData: FormData,
): Promise<CreateAccountResult> {
  await requireSuperadmin();

  const parsed = createAccountSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const result = await adminCreateAccount(parsed.data);
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath("/admin/contas");
  return { ok: true, email: parsed.data.email, tempPassword: result.tempPassword };
}

/** Troca o modelo de IA da plataforma. Vale para o próximo turno do agente. */
export async function changeAiModel(modelId: string) {
  const session = await requireSuperadmin();
  await setActiveModelId(modelId, session.user.email ?? undefined);
  revalidatePath("/admin/ia");
}

export type ImpersonateResult = { ok: boolean; error?: string };

/**
 * Entra como um usuário (normalmente o dono da conta): grava um cookie
 * assinado que faz os guards do dashboard tratar a sessão como a do cliente.
 * Sai com stopImpersonation(). Não dá para personificar conta do admin
 * (SUPERADMIN) nem a própria conta.
 */
export async function impersonateUser(userId: string): Promise<ImpersonateResult> {
  const session = await requireSuperadmin();

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, error: "Usuário não encontrado." };
  if (user.role === "SUPERADMIN") {
    return { ok: false, error: "Não é permitido personificar uma conta do admin." };
  }
  if (user.tenantId === session.user.tenantId) {
    return { ok: false, error: "Você já está na sua própria conta." };
  }
  const tenant = await prisma.tenant.findUnique({ where: { id: user.tenantId }, select: { status: true } });
  if (tenant?.status === "suspended") {
    return { ok: false, error: "Conta suspensa — reative-a antes de personificar." };
  }

  await setImpersonation({
    userId: user.id,
    email: user.email,
    role: user.role,
    tenantId: user.tenantId,
  });
  revalidatePath("/inicio");
  redirect("/inicio");
}

/** Encerra a personificação e volta ao painel do admin. */
export async function stopImpersonation() {
  await requireSuperadmin();
  await clearImpersonation();
  revalidatePath("/admin/contas");
  redirect("/admin/contas");
}
