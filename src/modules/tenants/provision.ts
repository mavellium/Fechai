import type { PlanKey, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

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

// Duração do trial de uso ilimitado que toda conta FREE nova ganha ao
// nascer. O superadmin pode estender, encurtar ou zerar por conta em
// /admin/contas (`Tenant.trialUnlimitedUntil`).
const FREE_TRIAL_DAYS = 7;

// Provisiona um tenant + usuário dono + configs base, tudo numa transação.
// Usado tanto pelo fluxo grátis quanto pelo webhook do Stripe (fluxo pago).
export async function createTenantWithOwner(input: CreateTenantWithOwnerInput) {
  const { tenantName, email, passwordHash, planKey = "FREE", role = "OWNER", lead } = input;

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const tenant = await tx.tenant.create({
      data: {
        name: tenantName,
        planKey,
        trialUnlimitedUntil:
          planKey === "FREE" ? new Date(Date.now() + FREE_TRIAL_DAYS * 24 * 60 * 60 * 1000) : null,
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
