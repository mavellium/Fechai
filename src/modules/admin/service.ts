import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { PlanKey, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { generateStrongPassword, BCRYPT_COST } from "@/lib/password";
import { createTenantWithOwner } from "@/modules/tenants/provision";
import { deleteFromBunny } from "@/lib/bunny";
import { getWhatsAppProvider } from "@/modules/whatsapp";
import { deleteVoice } from "@/modules/voice/fish";

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
    passwordHash: await bcrypt.hash(password, BCRYPT_COST),
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

/**
 * Apaga uma conta e tudo que pende dela, definitivamente.
 *
 * Só existe como último passo depois de suspender: `deleteTenant` recusa conta
 * ativa (ver a action). Suspender é reversível e cobre 99% dos casos — este
 * caminho é para pedido de exclusão de dados (LGPD art. 18, VI) e para limpar
 * conta de teste. Não há desfazer.
 *
 * O `onDelete: Cascade` do schema derruba users, agentes, leads, conversas,
 * mensagens, agendamentos, documentos e credenciais numa linha só. Duas coisas
 * NÃO são cobertas por ele, e é por isso que esta função é maior que um
 * `prisma.tenant.delete`:
 *
 *   1. O que vive fora do Postgres — a instância na Evolution (o número segue
 *      conectado, recebendo e queimando sessão) e os arquivos na BunnyCDN
 *      (widget.js, anexos da base de conhecimento, ícone, áudios). Apagar a
 *      linha e deixar isso de pé é o pior dos dois mundos: some do painel e
 *      continua existindo.
 *   2. `Referral.tenantId` é `SetNull` de propósito — a comissão já paga ao
 *      afiliado não é reescrita porque o cliente saiu. O histórico financeiro
 *      sobrevive à conta.
 *
 * A limpeza externa vem ANTES do delete e **nunca lança**: se a Evolution ou a
 * Bunny estiverem fora do ar, a exclusão continua. O contrário — abortar a
 * exclusão porque um terceiro caiu — deixaria o admin sem conseguir cumprir um
 * pedido de exclusão de dados por causa de um serviço de arquivo estático.
 */
export async function deleteTenant(tenantId: string): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      whatsappInstance: { select: { externalId: true } },
      agents: { select: { voiceId: true, voiceSource: true } },
      knowledgeDocs: { select: { fileUrl: true } },
    },
  });
  if (!tenant) return;

  await releaseExternalResources(tenant);

  await prisma.tenant.delete({ where: { id: tenantId } });
}

/**
 * Solta o que a conta ocupa fora do nosso banco. Cada passo é isolado: a falha
 * de um não impede os outros nem a exclusão em si — só vira log.
 */
async function releaseExternalResources(tenant: {
  id: string;
  whatsappInstance: { externalId: string | null } | null;
  agents: { voiceId: string | null; voiceSource: string | null }[];
  knowledgeDocs: { fileUrl: string | null }[];
}): Promise<void> {
  const externalId = tenant.whatsappInstance?.externalId;
  if (externalId) {
    try {
      // Logout, não delete: derruba a sessão do WhatsApp para o número não
      // seguir conectado a uma conta que não existe mais.
      await getWhatsAppProvider().disconnect(externalId);
    } catch (err) {
      console.error("[admin] falha ao desconectar WhatsApp da conta excluída", tenant.id, err);
    }
  }

  for (const agent of tenant.agents) {
    // Voz do catálogo é um modelo COMPARTILHADO entre contas: apagá-lo derruba
    // a voz de todo mundo que a escolheu. Só a gravada é nossa para apagar.
    if (agent.voiceId && agent.voiceSource !== "catalog") {
      try {
        await deleteVoice(agent.voiceId);
      } catch (err) {
        console.error("[admin] falha ao apagar voz da conta excluída", tenant.id, err);
      }
    }
  }

  // Arquivos da CDN. `deleteFromBunny` já é silencioso por dentro.
  await deleteFromBunny(`widget/${tenant.id}/widget.js`);
  for (const doc of tenant.knowledgeDocs) {
    const path = bunnyPathFromUrl(doc.fileUrl);
    if (path) await deleteFromBunny(path);
  }
}

/**
 * Converte a URL pública guardada no banco de volta no caminho da storage zone.
 * Guardamos a URL da pull zone (`https://<pull>/knowledge/...`), mas a API de
 * storage endereça pelo caminho — sem essa conversão o DELETE bate em 404 e o
 * arquivo fica órfão.
 */
function bunnyPathFromUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).pathname.replace(/^\/+/, "") || null;
  } catch {
    return null;
  }
}
