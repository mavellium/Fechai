// Cria o usuário admin padrão da plataforma — útil em produção depois de um
// `docker compose down -v` (que zera o banco) ou num banco recém-criado.
//
// Configuração (opcional, via env):
//   ADMIN_EMAIL      default: admin@fechai.local
//   ADMIN_PASSWORD   default: admin123  ← troque após o 1º login!
//   ADMIN_NAME       default: Admin
//   ADMIN_ROLE       default: SUPERADMIN  (OWNER para conta de cliente)
//   ADMIN_PLAN       default: FREE
//
// Uso local:  npm run db:admin
// Uso em prod: docker compose exec web npm run db:admin
import { PrismaClient, type PlanKey, type Prisma, type UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const DEFAULT_ACTION_KEYS = [
  "register_lead",
  "mark_hot_lead",
  "schedule_meeting",
  "follow_up",
  "handoff_human",
] as const;

async function createAdmin(tx: Prisma.TransactionClient, opts: {
  email: string;
  passwordHash: string;
  name: string;
  role: UserRole;
  planKey: PlanKey;
}) {
  const tenant = await tx.tenant.create({
    data: {
      name: opts.name,
      planKey: opts.planKey,
      onboardingCompleted: true,
      onboardingStep: 4,
      whatsappInstance: { create: { status: "disconnected" } },
      users: { create: { email: opts.email, passwordHash: opts.passwordHash, role: opts.role } },
    },
  });

  await tx.agent.create({
    data: {
      tenantId: tenant.id,
      name: opts.name,
      isPrimary: true,
      actions: {
        create: DEFAULT_ACTION_KEYS.map((key) => ({ tenantId: tenant.id, key, enabled: false })),
      },
    },
  });
}

async function main() {
  const email = process.env.ADMIN_EMAIL ?? "admin@fechai.local";
  const password = process.env.ADMIN_PASSWORD ?? "admin123";
  const name = process.env.ADMIN_NAME ?? "Admin";
  const role = (process.env.ADMIN_ROLE ?? "SUPERADMIN") as UserRole;
  const planKey = (process.env.ADMIN_PLAN ?? "FREE") as PlanKey;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`• ${email} já existe — nada a fazer.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.$transaction((tx) => createAdmin(tx, { email, passwordHash, name, role, planKey }));

  console.log(`✓ Admin criado: ${email} / ${password} (${role})`);
  console.log(`  Login: https://fechai.januscms.com.br — troque a senha após entrar!`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
