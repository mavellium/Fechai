import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { PlanKey, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createTenantWithOwner } from "@/modules/tenants/provision";

// Funções cross-tenant do painel admin. Autorização (SUPERADMIN) é garantida
// na rota (admin)/ via requireSuperadmin — nunca chamar fora dela.

export async function listTenants(search?: string) {
  return prisma.tenant.findMany({
    where: search ? { name: { contains: search, mode: "insensitive" } } : undefined,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      whatsappInstance: { select: { status: true } },
      users: { select: { id: true, email: true, role: true } },
      _count: { select: { users: true, leads: true, conversations: true } },
    },
  });
}

export async function getTenantDetail(tenantId: string) {
  return prisma.tenant.findUnique({
    where: { id: tenantId },
    include: {
      users: { select: { email: true, role: true, createdAt: true } },
      whatsappInstance: { select: { status: true } },
      _count: { select: { leads: true, conversations: true, knowledgeDocs: true, feedbacks: true } },
    },
  });
}

export async function setTenantStatus(tenantId: string, status: "active" | "suspended") {
  await prisma.tenant.update({ where: { id: tenantId }, data: { status } });
}

export async function adminSetPlan(tenantId: string, planKey: PlanKey) {
  await prisma.tenant.update({ where: { id: tenantId }, data: { planKey } });
}

/**
 * Fixa limites fora do padrão do plano (override) ou restaura o padrão com
 * `null`. O admin altera as duas cotas independentes: conversas/mês da conta e
 * o teto de respostas da IA por conversa. É o "alterar o limite da conta".
 */
export async function adminSetUsageLimit(
  tenantId: string,
  limit: number | null,
  perConversationCap?: number | null,
) {
  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      conversationLimitOverride: limit,
      ...(perConversationCap === undefined
        ? {}
        : { perConversationCapOverride: perConversationCap }),
    },
  });
}

/**
 * Cria uma conta pelo painel admin — qualquer papel, qualquer plano.
 *
 * Diferente do cadastro público (`/api/register`, que só faz OWNER + FREE):
 * aqui o superadmin escolhe papel e plano, e pode deixar a senha em branco
 * para o sistema gerar uma provisória (devolvida UMA vez para ser repassada).
 */
export async function adminCreateAccount(input: {
  tenantName: string;
  email: string;
  password?: string;
  role: UserRole;
  planKey: PlanKey;
}): Promise<{ ok: true; tempPassword?: string } | { ok: false; error: string }> {
  const email = input.email.trim().toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return { ok: false, error: "Já existe um usuário com esse e-mail." };

  // Sem senha informada: gera uma provisória e devolve para o admin repassar.
  const generated = input.password?.trim() ? undefined : generatePassword();
  const password = input.password?.trim() || (generated as string);

  await createTenantWithOwner({
    tenantName: input.tenantName.trim() || email.split("@")[0],
    email,
    passwordHash: await bcrypt.hash(password, 10),
    role: input.role,
    planKey: input.planKey,
  });

  return { ok: true, tempPassword: generated };
}

// Sem caracteres ambíguos (0/O, 1/l/I) — a senha vai ser lida e digitada por alguém.
const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generatePassword(length = 14): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}
