"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { PlanKey } from "@prisma/client";
import { requireSuperadmin } from "@/lib/session";
import { setTenantStatus, adminSetPlan, adminCreateAccount } from "@/modules/admin/service";
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
