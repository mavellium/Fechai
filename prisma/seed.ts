import { PrismaClient, type PlanKey, type UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const DEFAULT_ACTION_KEYS = [
  "register_lead",
  "mark_hot_lead",
  "schedule_meeting",
  "follow_up",
  "handoff_human",
] as const;

async function upsertTenantWithOwner(opts: {
  tenantName: string;
  planKey: PlanKey;
  email: string;
  password: string;
  role: UserRole;
  systemPrompt?: string;
  objective?: string;
  enabledActions?: string[];
  knowledge?: { title: string; content: string }[];
}) {
  const existing = await prisma.user.findUnique({ where: { email: opts.email } });
  if (existing) {
    console.log(`• ${opts.email} já existe — pulando`);
    return;
  }

  const passwordHash = await bcrypt.hash(opts.password, 10);
  const tenant = await prisma.tenant.create({
    data: {
      name: opts.tenantName,
      planKey: opts.planKey,
      // Contas de seed já vêm configuradas — não passam pelo wizard de /onboarding.
      onboardingCompleted: true,
      onboardingStep: 4,
      whatsappInstance: { create: { status: "disconnected" } },
      users: { create: { email: opts.email, passwordHash, role: opts.role } },
    },
  });

  // Agente principal do tenant. Base e ações penduram nele (escopo por agente).
  await prisma.agent.create({
    data: {
      tenantId: tenant.id,
      name: opts.tenantName,
      isPrimary: true,
      systemPrompt: opts.systemPrompt ?? "",
      objective: opts.objective ?? "",
      actions: {
        create: DEFAULT_ACTION_KEYS.map((key) => ({
          tenantId: tenant.id,
          key,
          enabled: opts.enabledActions?.includes(key) ?? false,
        })),
      },
      knowledgeDocs: opts.knowledge
        ? { create: opts.knowledge.map((doc) => ({ ...doc, tenantId: tenant.id })) }
        : undefined,
    },
  });
  console.log(`✓ Tenant "${tenant.name}" + ${opts.email} (${opts.role})`);
}

async function main() {
  // Superadmin (painel /admin) — tenant próprio só para o dono da plataforma.
  await upsertTenantWithOwner({
    tenantName: "Plataforma (Admin)",
    planKey: "BUSINESS",
    email: "superadmin@saas.local",
    password: "password123",
    role: "SUPERADMIN",
  });

  // Tenant de DEMONSTRAÇÃO — "escola de esportes" é só um template de exemplo,
  // o produto é genérico. Nada aqui deve ser hardcoded no motor.
  await upsertTenantWithOwner({
    tenantName: "Escola de Esportes Demo",
    planKey: "FREE",
    email: "demo@escola.local",
    password: "password123",
    role: "OWNER",
    systemPrompt:
      "Você é o atendente virtual de uma escola de esportes. Seja cordial, objetivo e comercial. " +
      "Responda dúvidas sobre modalidades, horários e valores usando apenas a base de conhecimento.",
    objective: "Qualificar o interessado e agendar uma aula experimental.",
    enabledActions: ["register_lead", "schedule_meeting"],
    knowledge: [
      {
        title: "Modalidades e horários",
        content:
          "Oferecemos natação, futsal e vôlei. Turmas de segunda a sábado, das 8h às 20h. " +
          "Aula experimental gratuita mediante agendamento.",
      },
    ],
  });
}

main()
  .then(() => console.log("Seed concluído."))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
