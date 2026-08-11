import { prisma } from "../src/lib/prisma";

async function main() {
  const agents = await prisma.agent.findMany({
    select: { id: true, name: true, enabled: true, tenantId: true, archived: true },
    orderBy: { createdAt: "asc" },
  });
  const tenants = await prisma.tenant.findMany({
    select: { id: true, name: true, widgetEnabled: true },
  });
  console.log(JSON.stringify({ agents, tenants }, null, 1));
}
main().finally(() => prisma.$disconnect());
