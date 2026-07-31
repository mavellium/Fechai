"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { PLAN_BY_KEY } from "@/modules/billing/plans";
import { composeSystemPrompt } from "@/modules/agent-engine/persona";
import { ACTION_CATALOG } from "@/modules/agent-engine/actions";
import {
  canComplete,
  draftSchema,
  draftToPersona,
  isStepNumber,
  parseDraft,
  resolveActionKeys,
} from "@/modules/tenants/onboarding-wizard";

type Result = { ok: boolean; error?: string };

const progressSchema = z.object({
  step: z.number().int().min(1).max(4),
  draft: draftSchema,
});

/**
 * Autosave do wizard. Guarda o rascunho e em qual passo o usuário está para
 * ele retomar de onde parou. Não escreve na configuração real do agente —
 * isso só acontece em completeOnboarding().
 */
export async function saveOnboardingProgress(input: {
  step: number;
  draft: unknown;
}): Promise<Result> {
  const { tenantId } = await requireTenant();

  const parsed = progressSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Não conseguimos salvar seu progresso." };

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { onboardingCompleted: true },
  });
  // Já concluiu: não deixa um autosave atrasado reabrir/regredir o onboarding.
  if (tenant?.onboardingCompleted) return { ok: true };

  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      onboardingStep: parsed.data.step,
      onboardingDraft: parsed.data.draft,
    },
  });

  return { ok: true };
}

/**
 * Conclui o onboarding: transforma as respostas do wizard na configuração real
 * do agente (persona + automações) e marca a conta como onboarded para o
 * wizard não aparecer de novo.
 */
export async function completeOnboarding(input: { draft: unknown }): Promise<Result> {
  const { tenantId } = await requireTenant();

  const draft = parseDraft(input.draft);
  if (!canComplete(draft)) {
    return { ok: false, error: "Faltou preencher alguma coisa. Volte e confira os passos." };
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true, planKey: true },
  });
  if (!tenant) return { ok: false, error: "Conta não encontrada." };

  const persona = draftToPersona(draft, tenant.name);
  const systemPrompt = composeSystemPrompt(persona);
  const limit = PLAN_BY_KEY[tenant.planKey].maxActiveActions;
  const enabledKeys = resolveActionKeys(draft, limit);

  // O onboarding configura o agente principal da conta (contas novas nascem
  // com exatamente um; agentes adicionais são criados depois em /agentes).
  const agent = await prisma.agent.findFirst({
    where: { tenantId, archived: false },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  if (!agent) return { ok: false, error: "Agente não encontrado." };

  // Tudo numa transação: ou a conta sai do onboarding com o agente configurado,
  // ou nada muda (evita conta "concluída" com agente vazio).
  await prisma.$transaction([
    prisma.agent.update({
      where: { id: agent.id },
      data: {
        name: persona.agentName || tenant.name,
        systemPrompt,
        objective: persona.objective,
        personaDraft: persona,
      },
    }),
    // Liga o que foi escolhido e desliga o resto, para o estado bater com o wizard.
    ...ACTION_CATALOG.map((action) =>
      prisma.tenantAction.upsert({
        where: { agentId_key: { agentId: agent.id, key: action.key } },
        create: {
          tenantId,
          agentId: agent.id,
          key: action.key,
          enabled: enabledKeys.includes(action.key),
        },
        update: { enabled: enabledKeys.includes(action.key) },
      }),
    ),
    prisma.tenant.update({
      where: { id: tenantId },
      data: {
        onboardingCompleted: true,
        onboardingStep: 4,
        onboardingDraft: draft,
      },
    }),
  ]);

  revalidatePath("/inicio");
  revalidatePath("/agentes");
  return { ok: true };
}

/** Reabre o wizard a partir de um passo específico (usado pela revisão final). */
export async function goToOnboardingStep(step: number): Promise<Result> {
  const { tenantId } = await requireTenant();
  if (!isStepNumber(step)) return { ok: false, error: "Passo inválido." };

  await prisma.tenant.update({
    where: { id: tenantId },
    data: { onboardingStep: step },
  });
  return { ok: true };
}
