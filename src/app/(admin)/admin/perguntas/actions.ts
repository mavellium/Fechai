"use server";

import { revalidatePath } from "next/cache";
import { requireSuperadmin } from "@/lib/session";
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
import { GAP_RESPONDERS, mavelliumAnswers, type GapResponders } from "@/modules/knowledge-gaps/settings";
import { setGapResponders } from "@/modules/knowledge-gaps/settings-store";

type Result = { ok: boolean; error?: string; info?: string };

/**
 * A Mavellium só mexe na fila de uma conta que a incluiu entre quem responde.
 * O tenant vem da página (`.bind`), então a checagem é aqui, a cada chamada —
 * um POST direto com outro id não passa.
 */
async function requireMavelliumResponder(tenantId: string): Promise<{ actor: GapActor } | { error: string }> {
  const session = await requireSuperadmin();
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
  if (!tenant) return { error: "Conta não encontrada." };
  const settings = await getGapSettings(tenantId);
  if (!mavelliumAnswers(settings.responders)) return { error: "Nesta conta a fila é respondida pela clínica." };
  return { actor: { id: session.user.id, label: "Mavellium", role: "mavellium" } };
}

function done(tenantId: string, result: GapActionResult): Result {
  revalidatePath("/admin/perguntas");
  return result.ok ? { ok: true, info: result.info } : { ok: false, error: result.error };
}

async function gapLabel(tenantId: string, gapId: string) {
  const gap = await prisma.knowledgeGap.findFirst({ where: { id: gapId, tenantId }, select: { question: true } });
  return gap?.question.slice(0, 120) ?? gapId;
}

export async function adminSaveGapDraft(tenantId: string, gapId: string, draft: string): Promise<Result> {
  const auth = await requireMavelliumResponder(tenantId);
  if ("error" in auth) return { ok: false, error: auth.error };
  return done(tenantId, await saveGapDraft(tenantId, gapId, draft));
}

export async function adminApproveGap(tenantId: string, gapId: string, answer: string, resumeMessage: string | null): Promise<Result> {
  const auth = await requireMavelliumResponder(tenantId);
  if ("error" in auth) return { ok: false, error: auth.error };
  const result = await approveGapAnswer({ tenantId, gapId, answer, actor: auth.actor, resumeMessage });
  if (result.ok) {
    await recordAudit({
      event: "knowledge.gap_answered",
      tenantId,
      target: { type: "KnowledgeGap", id: gapId, label: await gapLabel(tenantId, gapId) },
      after: { resposta: answer.trim(), documento: result.documentId, papel: "mavellium" },
      meta: result.resume ? { retomados: result.resume.sent, deFora: result.resume.skipped, semConfirmacao: result.resume.failed } : undefined,
    });
  }
  return done(tenantId, result);
}

export async function adminResumeGap(tenantId: string, gapId: string, message: string): Promise<Result> {
  const auth = await requireMavelliumResponder(tenantId);
  if ("error" in auth) return { ok: false, error: auth.error };
  const result = await resumeAnsweredGap(tenantId, gapId, message);
  if (result.ok && result.resume) {
    await recordAudit({
      event: "knowledge.gap_resumed",
      tenantId,
      target: { type: "KnowledgeGap", id: gapId, label: await gapLabel(tenantId, gapId) },
      meta: { retomados: result.resume.sent, deFora: result.resume.skipped, semConfirmacao: result.resume.failed },
    });
  }
  return done(tenantId, result);
}

export async function adminDismissGap(tenantId: string, gapId: string): Promise<Result> {
  const auth = await requireMavelliumResponder(tenantId);
  if ("error" in auth) return { ok: false, error: auth.error };
  const result = await dismissGap(tenantId, gapId);
  if (result.ok) {
    await recordAudit({ event: "knowledge.gap_dismissed", tenantId, target: { type: "KnowledgeGap", id: gapId, label: await gapLabel(tenantId, gapId) } });
  }
  return done(tenantId, result);
}

export async function adminReopenGap(tenantId: string, gapId: string): Promise<Result> {
  const auth = await requireMavelliumResponder(tenantId);
  if ("error" in auth) return { ok: false, error: auth.error };
  const result = await reopenGap(tenantId, gapId);
  if (result.ok) {
    await recordAudit({ event: "knowledge.gap_reopened", tenantId, target: { type: "KnowledgeGap", id: gapId, label: await gapLabel(tenantId, gapId) } });
  }
  return done(tenantId, result);
}

/** Quem responde a fila da conta — combinado com o cliente, só o superadmin define. */
export async function adminSetGapResponders(tenantId: string, value: string): Promise<Result> {
  await requireSuperadmin();
  if (!GAP_RESPONDERS.some((r) => r.value === value)) return { ok: false, error: "Opção inválida." };
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true } });
  if (!tenant) return { ok: false, error: "Conta não encontrada." };
  const before = await getGapSettings(tenantId);
  await setGapResponders(tenantId, value as GapResponders);
  await recordAudit({
    event: "admin.gap_responders_changed",
    tenantId,
    target: { type: "Tenant", id: tenantId, label: tenant.name },
    before: { quemResponde: before.responders },
    after: { quemResponde: value },
  });
  revalidatePath("/admin/perguntas");
  return { ok: true, info: "Salvo." };
}
