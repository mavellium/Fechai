/**
 * Marca como teste os leads/conversas do sandbox criados ANTES do campo
 * `isTest` existir. Sem isto, contas antigas continuam contando o contato
 * "Sandbox" como lead real nos relatórios.
 *
 * Rode uma vez, depois de `prisma db push`:
 *   npx tsx scripts/backfill-test-leads.ts
 *
 * Idempotente: rodar de novo não muda nada.
 */
import { prisma } from "../src/lib/prisma";

async function main() {
  const leads = await prisma.lead.updateMany({
    // "sandbox" era o telefone fixo antigo; "sandbox:<agentId>" é o formato novo.
    where: { isTest: false, OR: [{ phone: "sandbox" }, { phone: { startsWith: "sandbox:" } }] },
    data: { isTest: true },
  });

  const conversations = await prisma.conversation.updateMany({
    where: { isTest: false, lead: { isTest: true } },
    data: { isTest: true },
  });

  console.log(`leads marcados como teste: ${leads.count}`);
  console.log(`conversas marcadas como teste: ${conversations.count}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
