"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { PlanKey } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { payloadTooLarge } from "@/lib/rate-limit";
import { requireSuperadmin } from "@/lib/session";
import { setImpersonation, clearImpersonation } from "@/lib/impersonation";
import {
  setTenantStatus,
  adminSetPlan,
  adminSetUsageLimit,
  adminSetTrialEndsAt,
  adminCreateAccount,
  deleteTenant,
} from "@/modules/admin/service";
import { strongPassword } from "@/lib/password-schema";
import { setFeedbackStatus, type FeedbackStatus } from "@/modules/feedback/service";
import {
  createProvider,
  getActiveModel,
  getActiveModelId,
  invalidateChainCache,
  isAiError,
  getUsableChain,
  resolveSecret,
  setActiveModelId,
} from "@/modules/ai";
import { addCredential, clearCooldown, deleteCredential } from "@/modules/ai/credentials";
import { saveChain } from "@/modules/ai/chain";
import { isEncryptionConfigured } from "@/lib/crypto";

import { recordUsage } from "@/modules/ai/usage";

export async function suspendTenant(tenantId: string, suspend: boolean) {
  await requireSuperadmin();
  await setTenantStatus(tenantId, suspend ? "suspended" : "active");
  revalidatePath("/admin/contas");
}

export type DeleteTenantResult = { ok: boolean; error?: string };

/**
 * Exclui uma conta DEFINITIVAMENTE. Sem desfazer.
 *
 * Exige a conta já **suspensa**. Não é burocracia: suspender é o passo
 * reversível que dá tempo de perceber o engano, e obrigá-lo antes torna
 * impossível apagar a conta errada num clique só — a lista tem contas de nomes
 * parecidos e a linha de cima já é destrutiva. Quem confirma a exclusão já viu
 * a conta parada e sabe qual é.
 *
 * As checagens moram aqui, no servidor, e não só no botão: esconder a ação da
 * tela não é autorização, e a action é chamável direto.
 */
export async function deleteTenantAccount(tenantId: string): Promise<DeleteTenantResult> {
  const session = await requireSuperadmin();

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { status: true, users: { select: { role: true } } },
  });
  if (!tenant) return { ok: false, error: "Conta não encontrada." };

  // A própria conta do admin logado — apagá-la derrubaria quem está apagando.
  if (tenantId === session.user.tenantId) {
    return { ok: false, error: "Não é possível excluir a sua própria conta." };
  }
  // Conta de plataforma. Apagar a última SUPERADMIN tranca todo mundo para fora
  // do /admin, sem caminho de volta pela interface.
  if (tenant.users.some((u) => u.role === "SUPERADMIN")) {
    return { ok: false, error: "Contas de admin não podem ser excluídas pelo painel." };
  }
  if (tenant.status !== "suspended") {
    return { ok: false, error: "Suspenda a conta antes de excluí-la." };
  }

  await deleteTenant(tenantId);
  revalidatePath("/admin/contas");
  return { ok: true };
}

export async function changePlan(tenantId: string, planKey: PlanKey) {
  await requireSuperadmin();
  await adminSetPlan(tenantId, planKey);
  revalidatePath("/admin/contas");
}

/** Altera a cota de mensagens/mês da conta (null = volta ao padrão do plano). */
export async function setTenantUsageLimit(tenantId: string, limit: number | null) {
  await requireSuperadmin();
  await adminSetUsageLimit(tenantId, limit);
  revalidatePath("/admin/contas");
}

/**
 * Ajusta o período de teste da conta. `days` conta a partir de agora
 * (null = encerra o teste na hora, e a IA para até a pessoa assinar).
 */
export async function setTenantTrial(tenantId: string, days: number | null) {
  await requireSuperadmin();
  const endsAt = days == null ? null : new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  await adminSetTrialEndsAt(tenantId, endsAt);
  revalidatePath("/admin/contas");
}

export async function markFeedback(feedbackId: string, status: FeedbackStatus) {
  await requireSuperadmin();
  await setFeedbackStatus(feedbackId, status);
  revalidatePath("/admin/feedbacks");
}

export type CreateAccountResult = {
  ok: boolean;
  error?: string;
  /** Só volta quando o admin deixou a senha em branco. Mostrar UMA vez. */
  tempPassword?: string;
  email?: string;
};

const createAccountSchema = z.object({
  tenantName: z.string().trim().min(1, "Informe o nome da conta"),
  email: z.string().trim().toLowerCase().email("E-mail inválido"),
  // Vazio = gerar senha provisória (que já nasce dentro da política); qualquer
  // senha digitada segue a mesma regra de todo mundo.
  password: z.union([z.literal(""), strongPassword()]),
  role: z.enum(["OWNER", "SUPERADMIN"]),
  planKey: z.enum(["FREE", "STARTER", "PRO", "BUSINESS"]),
});

/** Cria uma conta (qualquer papel, qualquer plano) pelo painel admin. */
export async function createAccount(
  _prev: CreateAccountResult | null,
  formData: FormData,
): Promise<CreateAccountResult> {
  const tooLarge = payloadTooLarge(formData);
  if (tooLarge) return { ok: false, error: tooLarge };

  await requireSuperadmin();

  const parsed = createAccountSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const result = await adminCreateAccount(parsed.data);
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath("/admin/contas");
  return { ok: true, email: parsed.data.email, tempPassword: result.tempPassword };
}

/** Troca o modelo de IA da plataforma. Vale para o próximo turno do agente. */
export async function changeAiModel(modelId: string) {
  const session = await requireSuperadmin();
  await setActiveModelId(modelId, session.user.email ?? undefined);
  revalidatePath("/admin/ia");
}

/**
 * Teto por provedor no teste do painel. Sem isto, um provedor pendurado
 * deixaria o botão girando sem fim — e a chain nem chegaria a ser tentada.
 * Generoso porque um "cold start" de LLM passa de 30s em condição normal.
 */
const TEST_TIMEOUT_MS = 45_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`sem resposta em ${ms / 1000}s`)), ms),
    ),
  ]);
}

export type AiTestResult = {
  ok: boolean;
  /** Quem respondeu DE FATO — pode não ser o modelo ativo (ver abaixo). */
  provider?: string;
  model?: string;
  modelLabel?: string;
  /** O primeiro degrau da cadeia falhou e outro respondeu no lugar dele. */
  usedFallback?: boolean;
  /** Rótulo da chave que respondeu, ou null quando foi a do `.env`. */
  credentialLabel?: string | null;
  /** Modelo que estava configurado quando o teste rodou. */
  activeModel?: string;
  activeModelLabel?: string;
  /** Trecho da resposta — sinal de vida da API, não prova de identidade. */
  reply?: string;
  latencyMs?: number;
  tokens?: number;
  error?: string;
};

/**
 * Dispara uma chamada real ao LLM e diz QUEM respondeu.
 *
 * O painel mostrava o modelo configurado, mas o agente tem uma chain de
 * fallback (Gemini free → Grok → Groq): quando o modelo ativo estoura a cota,
 * outro provedor responde em silêncio. Sem esta prova, ler "Gemini 2.5 Flash"
 * na tela não significava que era o Gemini atendendo os leads.
 *
 * Percorre a MESMA chain do orquestrador (`getGeminiFallbackChain`) para que o
 * resultado valha para a conversa de verdade — um teste que só chamasse o
 * modelo ativo responderia outra pergunta.
 *
 * Não passa por `runAgentTurn` de propósito: nada de tenant, conversa, cota ou
 * histórico. É um ping ao provedor, e o custo é de uma frase.
 */
export async function testAiModel(): Promise<AiTestResult> {
  await requireSuperadmin();

  const active = await getActiveModel();
  const started = Date.now();

  // A MESMA cadeia do orquestrador — a que o admin montou, com as credenciais
  // dele. Um teste que percorresse outra ordem responderia outra pergunta.
  const chain = await getUsableChain();

  let lastError = "Nenhum provedor respondeu.";

  for (const [i, step] of chain.entries()) {
    const model = step.model;
    const isFallback = i > 0;
    const apiKey = await resolveSecret(model.provider, step.credentialId);
    if (!apiKey) {
      lastError = step.credentialId
        ? `A chave "${step.credentialLabel}" não pôde ser lida.`
        : `${model.envKey} não está configurada neste ambiente.`;
      continue;
    }
    try {
      const provider = createProvider(model, apiKey);
      // Um prompt trivial de propósito. Perguntar "qual modelo é você?" parece
      // a prova óbvia e não é: num teste real o Gemini respondeu "GPT-4o" —
      // modelos não sabem com segurança o próprio nome. Quem responde é o
      // provider que executou a chamada (`provider.provider`/`.model`), não o
      // texto gerado; o texto fica só como sinal de que a API respondeu.
      const result = await withTimeout(
        provider.complete([{ role: "user", content: "Responda apenas: ok" }], []),
        TEST_TIMEOUT_MS,
      );

      // Contabiliza como qualquer outra chamada: o teste gasta tokens de
      // verdade e some do relatório de uso seria mentir sobre o consumo.
      await recordUsage(provider.provider, result.usage).catch(() => {});

      return {
        ok: true,
        provider: provider.provider,
        model: provider.model,
        modelLabel: model.label,
        usedFallback: isFallback,
        credentialLabel: step.credentialLabel,
        activeModel: active.id,
        activeModelLabel: active.label,
        reply: result.content.trim().slice(0, 200),
        latencyMs: Date.now() - started,
        tokens: result.usage?.totalTokens,
      };
    } catch (err) {
      const who = step.credentialLabel ? `${model.label} (${step.credentialLabel})` : model.label;
      lastError = isAiError(err)
        ? `${who}: ${err.code}`
        : `${who}: ${err instanceof Error ? err.message : "falha inesperada"}.`;
    }
  }

  return { ok: false, error: lastError, activeModel: active.id, activeModelLabel: active.label };
}

/* ------------------------------------------------------------------ *
 * Cadeia de fallback e credenciais de IA.
 * ------------------------------------------------------------------ */

const credentialSchema = z
  .object({
    provider: z.enum(["gemini", "openai", "grok", "groq", "custom"]),
    label: z.string().trim().max(60),
    // Sem `.max()` apertado: chaves de provedores variam muito de formato e
    // tamanho, e recusar uma válida por palpite seria pior que aceitar.
    secret: z.string().trim().min(8, "Chave curta demais para ser válida."),
    baseUrl: z.string().trim().optional(),
    modelId: z.string().trim().max(120).optional(),
  })
  .refine((v) => v.provider !== "custom" || Boolean(v.baseUrl && v.modelId), {
    message: "Provedor personalizado precisa de URL base e nome do modelo.",
  })
  .refine((v) => v.provider !== "custom" || /^https:\/\//i.test(v.baseUrl ?? ""), {
    // https obrigatório: a chave viaja no header, e http entregaria a
    // credencial em texto claro para qualquer um no caminho.
    message: "A URL base precisa começar com https://",
  });

export type SaveResult = { ok: boolean; error?: string };

/** Cadastra uma chave de API. O segredo é cifrado antes de tocar o banco. */
export async function addAiCredential(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const session = await requireSuperadmin();

  if (!isEncryptionConfigured()) {
    return {
      ok: false,
      error: "Falta ENCRYPTION_KEY no servidor — sem ela a chave não pode ser guardada com segurança.",
    };
  }

  const parsed = credentialSchema.safeParse({
    provider: formData.get("provider"),
    label: formData.get("label"),
    secret: formData.get("secret"),
    baseUrl: formData.get("baseUrl") ?? undefined,
    modelId: formData.get("modelId") ?? undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  try {
    await addCredential({ ...parsed.data, createdBy: session.user.email ?? undefined });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Não foi possível salvar." };
  }

  revalidatePath("/admin/ia");
  return { ok: true };
}

export async function removeAiCredential(id: string): Promise<SaveResult> {
  await requireSuperadmin();
  try {
    await deleteCredential(id);
  } catch {
    return { ok: false, error: "Não foi possível remover a chave." };
  }
  invalidateChainCache();
  revalidatePath("/admin/ia");
  return { ok: true };
}

/** Tira a credencial da quarentena antes da hora. */
export async function clearAiCooldown(id: string): Promise<SaveResult> {
  await requireSuperadmin();
  try {
    await clearCooldown(id);
  } catch {
    return { ok: false, error: "Não foi possível liberar a chave." };
  }
  invalidateChainCache();
  revalidatePath("/admin/ia");
  return { ok: true };
}

/** Regrava a cadeia inteira, na ordem que o admin montou. */
export async function saveAiChain(
  steps: { modelId: string; credentialId: string | null; enabled: boolean }[],
): Promise<SaveResult> {
  await requireSuperadmin();
  try {
    await saveChain(steps);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Não foi possível salvar a sequência.",
    };
  }
  revalidatePath("/admin/ia");
  return { ok: true };
}

/** Minutos de quarentena depois de uma falha de cota (0 desliga). */
export async function setAiCooldownMinutes(minutes: number): Promise<SaveResult> {
  const session = await requireSuperadmin();
  const value = Math.trunc(minutes);
  if (!Number.isInteger(value) || value < 0 || value > 10_080) {
    return { ok: false, error: "Informe de 0 a 10080 minutos (até uma semana)." };
  }
  await prisma.aiSetting.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      modelId: await getActiveModelId(),
      cooldownMinutes: value,
      updatedBy: session.user.email ?? undefined,
    },
    update: { cooldownMinutes: value, updatedBy: session.user.email ?? undefined },
  });
  invalidateChainCache();
  revalidatePath("/admin/ia");
  return { ok: true };
}

export type ImpersonateResult = { ok: boolean; error?: string };

/**
 * Entra como um usuário (normalmente o dono da conta): grava um cookie
 * assinado que faz os guards do dashboard tratar a sessão como a do cliente.
 * Sai com stopImpersonation(). Não dá para personificar conta do admin
 * (SUPERADMIN) nem a própria conta.
 */
export async function impersonateUser(userId: string): Promise<ImpersonateResult> {
  const session = await requireSuperadmin();

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, error: "Usuário não encontrado." };
  if (user.role === "SUPERADMIN") {
    return { ok: false, error: "Não é permitido personificar uma conta do admin." };
  }
  if (user.tenantId === session.user.tenantId) {
    return { ok: false, error: "Você já está na sua própria conta." };
  }
  const tenant = await prisma.tenant.findUnique({ where: { id: user.tenantId }, select: { status: true } });
  if (tenant?.status === "suspended") {
    return { ok: false, error: "Conta suspensa — reative-a antes de personificar." };
  }

  await setImpersonation({
    userId: user.id,
    email: user.email,
    role: user.role,
    tenantId: user.tenantId,
  });
  revalidatePath("/inicio");
  redirect("/inicio");
}

/** Encerra a personificação e volta ao painel do admin. */
export async function stopImpersonation() {
  await requireSuperadmin();
  await clearImpersonation();
  revalidatePath("/admin/contas");
  redirect("/admin/contas");
}
