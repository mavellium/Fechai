import { prisma } from "../src/lib/prisma";

async function main() {
  const convs = await prisma.conversation.findMany({
    where: { lead: { phone: { startsWith: "sandbox" } } },
    select: {
      id: true,
      lead: { select: { phone: true } },
      agentPaused: true,
      needsHuman: true,
      isTest: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
  });
  console.log(JSON.stringify(convs, null, 1));
}
main().finally(() => prisma.$disconnect());
