/**
 * Remove um nome de perfil da conta que foi atribuído por engano aos contatos
 * quando o webhook recebeu uma mensagem `fromMe`.
 *
 * Prévia: npx tsx scripts/corrige-nome-whatsapp-saida.ts email@conta.com "Nome do perfil"
 * Aplicar: npx tsx scripts/corrige-nome-whatsapp-saida.ts email@conta.com "Nome do perfil" --apply
 *
 * Só atua na conta do email informado e preserva nomes que o contato disse
 * explicitamente (variável `nome` da conversa). Sem `--apply`, nada é alterado.
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";

async function main() {
  const [email, mistakenName, flag] = process.argv.slice(2);
  if (!email || !mistakenName?.trim() || (flag && flag !== "--apply")) {
    throw new Error('Uso: npx tsx scripts/corrige-nome-whatsapp-saida.ts <email> "<nome do perfil>" [--apply]');
  }

  const user = await prisma.user.findUnique({ where: { email }, select: { tenantId: true } });
  if (!user) throw new Error("Conta não encontrada");

  const leads = await prisma.lead.findMany({
    where: { tenantId: user.tenantId, isTest: false, name: mistakenName.trim() },
    select: { id: true, conversation: { select: { variables: true } } },
  });
  const affected = leads.filter(({ conversation }) => {
    const variables = conversation?.variables;
    if (!variables || typeof variables !== "object" || Array.isArray(variables)) return true;
    const confirmedName = (variables as Record<string, unknown>).nome;
    return typeof confirmedName !== "string" || !confirmedName.trim();
  });

  console.log(`Contatos com o nome informado: ${leads.length}`);
  console.log(`Com nome confirmado pelo contato, preservados: ${leads.length - affected.length}`);
  console.log(`A corrigir para exibir o número: ${affected.length}`);

  if (flag === "--apply" && affected.length) {
    const result = await prisma.lead.updateMany({
      where: { tenantId: user.tenantId, id: { in: affected.map(({ id }) => id) }, name: mistakenName.trim() },
      data: { name: null },
    });
    console.log(`Corrigidos: ${result.count}`);
  } else if (flag !== "--apply") {
    console.log("Prévia apenas. Use --apply para corrigir.");
  }
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
