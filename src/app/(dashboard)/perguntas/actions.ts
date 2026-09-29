"use server";

import { revalidatePath } from "next/cache";
import { requireProductAccess } from "@/lib/require-product";
import { payloadTooLarge } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/modules/audit/log";
import {
  approveGapAnswer,
  dismissGap,
  reopenGap,
  resumeAnsweredGap,
  saveGapDraft,
  type GapActionResult,
  type GapActor,
} from "@/modules/knowledge-gaps/answer";
import { getGapSettings } from "@/modules/knowledge-gaps/register";
import { clinicAnswers, mavelliumAnswers } from "@/modules/knowledge-gaps/settings";
import { gapSettingsFormSchema, saveGapSettings } from "@/modules/knowledge-gaps/settings-store";

type Result = { ok: boolean; error?: string; info?: string };

/**
 * Guarda de toda action da fila: produto (não só afiliado) + permissão de
 * responder. Quem personifica é a Mavellium — responde como ela, e só quando
 * a conta a incluiu entre quem responde. Layout e botão escondido não
 * autorizam nada.
 */
async function requireGapResponder(): Promise<{ tenantId: string; actor: GapActor } | { error: string }> {
  const { session } = await requireProductAccess();
  const tenantId = session.user.tenantId;
  const settings = await getGapSettings(tenantId);
  const mavellium = session.user.impersonating === true;
  const allowed = mavellium ? mavelliumAnswers(settings.responders) : clinicAnswers(settings.responders);
  if (!allowed) {
    return {
      error: mavellium
        ? "Nesta conta a fila é respondida pela clínica."
        : "Nesta conta a fila é respondida pela Mavellium.",
    };
  }
  return {
    tenantId,
    actor: {
      id: session.user.id,
      label: session.user.email ?? session.user.name ?? session.user.id,
      role: mavellium ? "mavellium" : "clinic",
    },
  };
}

async function gapLabel(tenantId: string, gapId: string) {
  const gap = await prisma.knowledgeGap.findFirst({ where: { id: gapId, tenantId }, select: { question: true } });
  return gap?.question.slice(0, 120) ?? gapId;
}

function done(result: GapActionResult): Result {
  revalidatePath("/perguntas");
  return result.ok ? { ok: true, info: result.info } : { ok: false, error: result.error };
}

export async function saveGapDraftAction(gapId: string, draft: string): Promise<Result> {
  const auth = await requireGapResponder();
  if ("error" in auth) return { ok: false, error: auth.error };
  return done(await saveGapDraft(auth.tenantId, gapId, draft));
}

export async function approveGapAction(gapId: string, answer: string, resumeMessage: string | null): Promise<Result> {
  const auth = await requireGapResponder();
  if ("error" in auth) return { ok: false, error: auth.error };
  const result = await approveGapAnswer({ tenantId: auth.tenantId, gapId, answer, actor: auth.actor, resumeMessage });
  if (result.ok) {
    await recordAudit({
      event: "knowledge.gap_answered",
      target: { type: "KnowledgeGap", id: gapId, label: await gapLabel(auth.tenantId, gapId) },
      after: { resposta: answer.trim(), documento: result.documentId, papel: auth.actor.role },
      meta: result.resume ? { retomados: result.resume.sent, deFora: result.resume.skipped, semConfirmacao: result.resume.failed } : undefined,
    });
    revalidatePath("/agentes", "layout");
  }
  return done(result);
}

export async function resumeGapAction(gapId: string, message: string): Promise<Result> {
  const auth = await requireGapResponder();
  if ("error" in auth) return { ok: false, error: auth.error };
  const result = await resumeAnsweredGap(auth.tenantId, gapId, message);
  if (result.ok && result.resume) {
    await recordAudit({
      event: "knowledge.gap_resumed",
      target: { type: "KnowledgeGap", id: gapId, label: await gapLabel(auth.tenantId, gapId) },
      meta: { retomados: result.resume.sent, deFora: result.resume.skipped, semConfirmacao: result.resume.failed },
    });
  }
  return done(result);
}

export async function dismissGapAction(gapId: string): Promise<Result> {
  const auth = await requireGapResponder();
  if ("error" in auth) return { ok: false, error: auth.error };
  const result = await dismissGap(auth.tenantId, gapId);
  if (result.ok) {
    await recordAudit({ event: "knowledge.gap_dismissed", target: { type: "KnowledgeGap", id: gapId, label: await gapLabel(auth.tenantId, gapId) } });
  }
  return done(result);
}

export async function reopenGapAction(gapId: string): Promise<Result> {
  const auth = await requireGapResponder();
  if ("error" in auth) return { ok: false, error: auth.error };
  const result = await reopenGap(auth.tenantId, gapId);
  if (result.ok) {
    await recordAudit({ event: "knowledge.gap_reopened", target: { type: "KnowledgeGap", id: gapId, label: await gapLabel(auth.tenantId, gapId) } });
  }
  return done(result);
}

/**
 * Regra e avisos da conta. Qualquer pessoa da conta ajusta — inclusive
 * quando a Mavellium responde a fila: o transbordo é regra de atendimento da
 * clínica, e os avisos são para a equipe dela.
 */
export async function saveGapSettingsAction(_prev: Result | null, formData: FormData): Promise<Result> {
  const tooLarge = payloadTooLarge(formData);
  if (tooLarge) return { ok: false, error: tooLarge };
  const { session } = await requireProductAccess();
  const tenantId = session.user.tenantId;

  const parsed = gapSettingsFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };

  const before = await getGapSettings(tenantId);
  const after = await saveGapSettings(tenantId, parsed.data);
  await recordAudit({
    event: "knowledge.gap_settings_updated",
    target: { type: "KnowledgeGapSettings", id: tenantId, label: "Perguntas sem resposta" },
    before: { ...before, responders: undefined },
    after: { ...after, responders: undefined },
  });
  revalidatePath("/perguntas");
  return { ok: true, info: "Regra e avisos salvos." };
}
