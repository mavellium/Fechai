import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { PlanKey, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { generateStrongPassword } from "@/lib/password";
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
 * Fixa a cota de mensagens/mês fora do padrão do plano (override), ou restaura
 * o padrão com `null`. É o "alterar o limite da conta" — agora uma cota só, em
 * mensagens (a cota de conversas e o teto por conversa deixaram de existir).
 */
export async function adminSetUsageLimit(tenantId: string, limit: number | null) {
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { messageLimitOverride: limit },
  });
}

/**
 * Fixa (ou encerra, com `null`) o fim do período de teste da conta. Passada a
 * data, `runAgentTurn` cala a IA até a pessoa assinar — o painel segue
 * acessível. É como o admin dá mais alguns dias a quem pediu, ou corta o teste
 * na hora.
 */
export async function adminSetTrialEndsAt(tenantId: string, endsAt: Date | null) {
  await prisma.tenant.update({ where: { id: tenantId }, data: { trialEndsAt: endsAt } });
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

/**
 * Senha provisória do admin. Delega para `generateStrongPassword` porque a
 * gerada antes (só letras e dígitos) não passaria na política que agora vale
 * para todo mundo — o admin criaria contas com senha que o próprio produto
 * recusa na troca.
 */
function generatePassword(): string {
  return generateStrongPassword((n) => new Uint8Array(randomBytes(n)));
}
