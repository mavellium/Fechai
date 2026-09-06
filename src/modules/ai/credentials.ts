import { prisma } from "@/lib/prisma";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { PROVIDER_ENV_KEY } from "./usage";
import type { ProviderKey } from "./types";

/**
 * Chaves de API dos provedores de IA cadastradas pelo admin.
 *
 * Antes só existia a chave do `.env`, uma por provedor: acrescentar um
 * provedor ou uma segunda chave exigia editar o ambiente e reiniciar. Aqui as
 * chaves vivem no banco, **cifradas** (AES-256-GCM, `src/lib/crypto.ts`), e o
 * admin adiciona ou remove pelo painel.
 *
 * Duas regras que não podem ser contornadas:
 *
 * 1. **Nunca leia `secretEncrypted` direto do Prisma.** `resolveSecret()`
 *    decifra na leitura; passar por fora manda o texto cifrado no header
 *    `Authorization` e devolve um 401 difícil de diagnosticar. Mesmo erro que
 *    o README de agenda descreve para o Clinicorp.
 *
 * 2. **O segredo nunca vai para o cliente.** As funções de listagem devolvem
 *    só rótulo e últimos quatro dígitos — o suficiente para o admin saber qual
 *    é qual, e nada além.
 *
 * A chave do `.env` continua valendo como padrão do provedor: quem nunca mexeu
 * no painel não perde nada, e um degrau da cadeia sem credencial explícita usa
 * o ambiente.
 */

/** O que pode ir para o cliente: tudo menos o segredo. */
export type SafeCredential = {
  id: string;
  provider: ProviderKey;
  label: string;
  /** Só em provedor cadastrado pelo admin: URL base e modelo digitados. */
  baseUrl: string | null;
  modelId: string | null;
  lastFour: string;
  /** Em quarentena até quando (ISO), ou null se disponível agora. */
  cooldownUntil: string | null;
  lastError: string | null;
  lastUsedAt: string | null;
};

export function toSafeCredential(row: {
  id: string;
  provider: string;
  label: string;
  baseUrl: string | null;
  modelId: string | null;
  lastFour: string;
  cooldownUntil: Date | null;
  lastError: string | null;
  lastUsedAt: Date | null;
}): SafeCredential {
  return {
    id: row.id,
    provider: row.provider as ProviderKey,
    label: row.label,
    baseUrl: row.baseUrl,
    modelId: row.modelId,
    lastFour: row.lastFour,
    cooldownUntil: row.cooldownUntil ? row.cooldownUntil.toISOString() : null,
    lastError: row.lastError,
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
  };
}

export async function listCredentials(): Promise<SafeCredential[]> {
  const rows = await prisma.aiCredential.findMany({
    orderBy: [{ provider: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toSafeCredential);
}

/**
 * Cadastra uma chave. O segredo é cifrado antes de tocar o banco e só os
 * últimos quatro caracteres ficam em claro, para o admin diferenciar duas
 * chaves do mesmo provedor sem que a lista revele nenhuma delas.
 */
export async function addCredential(input: {
  provider: ProviderKey;
  label: string;
  secret: string;
  /** Obrigatórios quando `provider` é "custom". */
  baseUrl?: string;
  modelId?: string;
  createdBy?: string;
}): Promise<SafeCredential> {
  const secret = input.secret.trim();
  if (!secret) throw new Error("A chave não pode ficar em branco.");

  if (input.provider === "custom" && (!input.baseUrl?.trim() || !input.modelId?.trim())) {
    throw new Error("Provedor personalizado precisa de URL base e nome do modelo.");
  }

  const row = await prisma.aiCredential.create({
    data: {
      provider: input.provider,
      // Sem barra no fim: o SDK monta "/chat/completions" a partir daqui, e
      // "…/v1//chat/completions" quebra em alguns servidores.
      baseUrl: input.baseUrl?.trim().replace(/\/+$/, "") || null,
      modelId: input.modelId?.trim() || null,
      label: input.label.trim() || `${input.provider} ${new Date().toLocaleDateString("pt-BR")}`,
      secretEncrypted: encryptSecret(secret),
      lastFour: secret.slice(-4),
      createdBy: input.createdBy,
    },
  });
  return toSafeCredential(row);
}

export async function deleteCredential(id: string): Promise<void> {
  // Os degraus que apontavam para ela caem em `credentialId: null` (SetNull no
  // schema) e voltam a usar a chave do `.env` — a cadeia não fica com um
  // buraco só porque uma credencial foi removida.
  await prisma.aiCredential.delete({ where: { id } });
}

/**
 * A chave em texto claro para usar na chamada.
 *
 * `credentialId` nulo (ou credencial que sumiu) cai no `.env` do provedor —
 * é o caminho de quem nunca cadastrou nada no painel.
 */
export async function resolveSecret(
  provider: ProviderKey,
  credentialId: string | null,
): Promise<string | undefined> {
  if (!credentialId) return process.env[PROVIDER_ENV_KEY[provider]];

  const row = await prisma.aiCredential.findUnique({ where: { id: credentialId } });
  if (!row) return process.env[PROVIDER_ENV_KEY[provider]];

  // `decryptSecret` devolve null em vez de lançar quando o valor não abre
  // (ENCRYPTION_KEY trocada sem rotação, linha adulterada). Cair no ambiente
  // mantém o agente respondendo em vez de derrubar o turno.
  const plain = decryptSecret(row.secretEncrypted);
  if (plain === null) {
    console.error(`[ai/credentials] falha ao decifrar credencial ${row.id}`);
    return process.env[PROVIDER_ENV_KEY[provider]];
  }
  return plain;
}

/**
 * Põe a credencial de molho depois de uma falha de cota.
 *
 * Sem isto, cada turno gastaria uma tentativa (e a latência do erro) numa
 * chave que já se sabe esgotada antes de cair para a seguinte. `minutes` vem
 * da configuração do admin: a janela certa depende do provedor — free tier que
 * renova por minuto não é cota diária.
 */
export async function markCredentialCooldown(
  credentialId: string,
  minutes: number,
  error: string,
): Promise<void> {
  await prisma.aiCredential.update({
    where: { id: credentialId },
    data: {
      cooldownUntil: minutes > 0 ? new Date(Date.now() + minutes * 60_000) : null,
      lastError: error.slice(0, 200),
    },
  });
}

/** Registra uso bem-sucedido e limpa a quarentena — a chave voltou a servir. */
export async function markCredentialOk(credentialId: string): Promise<void> {
  await prisma.aiCredential.update({
    where: { id: credentialId },
    data: { cooldownUntil: null, lastError: null, lastUsedAt: new Date() },
  });
}

/** Tira a credencial da quarentena manualmente (botão do painel). */
export async function clearCooldown(credentialId: string): Promise<void> {
  await prisma.aiCredential.update({
    where: { id: credentialId },
    data: { cooldownUntil: null, lastError: null },
  });
}
