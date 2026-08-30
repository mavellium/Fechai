import type { PlanKey, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { planOf } from "@/modules/billing/plans";

// Ações padrão criadas para todo tenant novo (toggle off por padrão).
export const DEFAULT_ACTION_KEYS = [
  "register_lead",
  "mark_hot_lead",
  "schedule_meeting",
  "follow_up",
  "handoff_human",
] as const;

type CreateTenantWithOwnerInput = {
  tenantName: string;
  email: string;
  passwordHash: string;
  planKey?: PlanKey;
  role?: "OWNER" | "SUPERADMIN";
  /**
   * A pessoa vai usar o agente, ou entrou só para o programa de afiliados?
   * Default `true`: toda origem que não pergunta (admin, seed) é de cliente.
   * `false` deixa o painel enxuto — ver `modules/affiliates/roles.ts`.
   */
  usesProduct?: boolean;
  /**
   * Qualificação do lead — vem do /cadastro público (`/api/register`). Ausente
   * na criação pelo admin (/admin/contas), que não passa pelo formulário.
   */
  lead?: {
    document?: string;
    phone?: string;
    phoneSecondary?: string;
    birthDate?: Date;
    gender?: string;
    city?: string;
    state?: string;
    businessSegment?: string;
    referralSource?: string;
  };
};

// Provisiona um tenant + usuário dono + configs base, tudo numa transação.
// Usado tanto pelo fluxo grátis quanto pelo webhook do Stripe (fluxo pago).
export async function createTenantWithOwner(input: CreateTenantWithOwnerInput) {
  const {
    tenantName,
    email,
    passwordHash,
    planKey = "FREE",
    role = "OWNER",
    lead,
    usesProduct = true,
  } = input;

  // Planos de teste (só o FREE hoje) nascem com a data de fim; nos pagos fica
  // null — a assinatura é que mantém a conta viva. A duração vem do plano,
  // não de uma constante aqui, para não haver dois lugares dizendo "7 dias".
  const trialDays = planOf(planKey).trialDays;
  const trialEndsAt = trialDays ? new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000) : null;

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const tenant = await tx.tenant.create({
      data: {
        name: tenantName,
        planKey,
        trialEndsAt,
        city: lead?.city,
        state: lead?.state,
        businessSegment: lead?.businessSegment,
        referralSource: lead?.referralSource,
        whatsappInstance: { create: { status: "disconnected" } },
      },
    });

    // Primeiro agente da conta (principal). As ações padrão penduram nele, não
    // mais no tenant — o escopo virou por agente.
    await tx.agent.create({
      data: {
        tenantId: tenant.id,
        name: tenantName,
        isPrimary: true,
        actions: {
          create: DEFAULT_ACTION_KEYS.map((key) => ({ tenantId: tenant.id, key, enabled: false })),
        },
      },
    });

    const user = await tx.user.create({
      data: {
        email,
        passwordHash,
        role,
        tenantId: tenant.id,
        usesProduct,
        document: lead?.document,
        phone: lead?.phone,
        phoneSecondary: lead?.phoneSecondary,
        birthDate: lead?.birthDate,
        gender: lead?.gender,
      },
    });

    return { tenant, user };
  });
}
