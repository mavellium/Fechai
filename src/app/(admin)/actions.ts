"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { PlanKey } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { payloadTooLarge } from "@/lib/rate-limit";
import { requireSuperadmin } from "@/lib/session";
import { setImpersonation, clearImpersonation } from "@/lib/impersonation";
import {
  setTenantStatus,
  adminSetPlan,
  adminSetUsageLimit,
  adminSetTrialEndsAt,
  adminCreateAccount,
  deleteTenant,
} from "@/modules/admin/service";
import { strongPassword } from "@/lib/password-schema";
import { setFeedbackStatus, type FeedbackStatus } from "@/modules/feedback/service";
import { setActiveModelId } from "@/modules/ai";

export async function suspendTenant(tenantId: string, suspend: boolean) {
  await requireSuperadmin();
  await setTenantStatus(tenantId, suspend ? "suspended" : "active");
  revalidatePath("/admin/contas");
}

export type DeleteTenantResult = { ok: boolean; error?: string };

/**
 * Exclui uma conta DEFINITIVAMENTE. Sem desfazer.
 *
 * Exige a conta já **suspensa**. Não é burocracia: suspender é o passo
 * reversível que dá tempo de perceber o engano, e obrigá-lo antes torna
 * impossível apagar a conta errada num clique só — a lista tem contas de nomes
 * parecidos e a linha de cima já é destrutiva. Quem confirma a exclusão já viu
 * a conta parada e sabe qual é.
 *
 * As checagens moram aqui, no servidor, e não só no botão: esconder a ação da
 * tela não é autorização, e a action é chamável direto.
 */
export async function deleteTenantAccount(tenantId: string): Promise<DeleteTenantResult> {
  const session = await requireSuperadmin();

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { status: true, users: { select: { role: true } } },
  });
  if (!tenant) return { ok: false, error: "Conta não encontrada." };

  // A própria conta do admin logado — apagá-la derrubaria quem está apagando.
  if (tenantId === session.user.tenantId) {
    return { ok: false, error: "Não é possível excluir a sua própria conta." };
  }
  // Conta de plataforma. Apagar a última SUPERADMIN tranca todo mundo para fora
  // do /admin, sem caminho de volta pela interface.
  if (tenant.users.some((u) => u.role === "SUPERADMIN")) {
    return { ok: false, error: "Contas de admin não podem ser excluídas pelo painel." };
  }
  if (tenant.status !== "suspended") {
    return { ok: false, error: "Suspenda a conta antes de excluí-la." };
  }

  await deleteTenant(tenantId);
  revalidatePath("/admin/contas");
  return { ok: true };
}

export async function changePlan(tenantId: string, planKey: PlanKey) {
  await requireSuperadmin();
  await adminSetPlan(tenantId, planKey);
  revalidatePath("/admin/contas");
}

/** Altera a cota de mensagens/mês da conta (null = volta ao padrão do plano). */
export async function setTenantUsageLimit(tenantId: string, limit: number | null) {
  await requireSuperadmin();
  await adminSetUsageLimit(tenantId, limit);
  revalidatePath("/admin/contas");
}

/**
 * Ajusta o período de teste da conta. `days` conta a partir de agora
 * (null = encerra o teste na hora, e a IA para até a pessoa assinar).
 */
export async function setTenantTrial(tenantId: string, days: number | null) {
  await requireSuperadmin();
  const endsAt = days == null ? null : new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  await adminSetTrialEndsAt(tenantId, endsAt);
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
  // Vazio = gerar senha provisória (que já nasce dentro da política); qualquer
  // senha digitada segue a mesma regra de todo mundo.
  password: z.union([z.literal(""), strongPassword()]),
  role: z.enum(["OWNER", "SUPERADMIN"]),
  planKey: z.enum(["FREE", "STARTER", "PRO", "BUSINESS"]),
});

/** Cria uma conta (qualquer papel, qualquer plano) pelo painel admin. */
export async function createAccount(
  _prev: CreateAccountResult | null,
  formData: FormData,
): Promise<CreateAccountResult> {
  const tooLarge = payloadTooLarge(formData);
  if (tooLarge) return { ok: false, error: tooLarge };

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
