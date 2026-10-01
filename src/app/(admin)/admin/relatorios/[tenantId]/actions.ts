"use server";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSuperadmin } from "@/lib/session";
import { payloadTooLarge } from "@/lib/rate-limit";
import { monthlyAssumptionsSchema, monthKey, monthlyWindow } from "@/modules/reports/monthly-config";
import { FEATURED_CASE_MAX, featuredCaseProblem, reviewTextProblem } from "@/modules/reports/monthly-time";
import { HIGHLIGHTS_MAX, LIMITATIONS_NOTE_MAX, sameLimitations, unverifiedMetrics } from "@/modules/reports/monthly-limitations";
import { computeMonthlyReport, type MonthlyReport } from "@/modules/reports/monthly";
import { hasNextPlan, nextActionsSchema, type MonthlyNextAction } from "@/modules/reports/monthly-next-actions";
import { monthlyOverridesSchema, parseMonthlyOverrides, editableMonthlyMetrics } from "@/modules/reports/monthly-overrides";
import { recordAudit } from "@/modules/audit/log";
import { createHash } from "node:crypto";
import { agentChangesSchema, type ReportedAgentChange } from "@/modules/reports/monthly-agent-changes";
import { blockingIssues, validateMonthlyReport } from "@/modules/reports/monthly-validate";

type Result = { ok: boolean; error?: string; info?: string };
function invalidate(tenantId: string) {
  revalidatePath(`/admin/relatorios/${tenantId}`);
  revalidatePath("/admin/relatorios");
  revalidatePath("/relatorios");
}
function validMonth(month: string) { return monthKey(month) === month; }
async function validAgents(tenantId: string, ids: string[] = []) {
  if (!ids.length) return true;
  const agents = await prisma.agent.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true } });
  return agents.length === ids.length;
}

/** Prévia somente de leitura; configurações do agente e agenda não são alteradas. */
export async function previewMonthlyRoiImport(tenantId: string, month: string, form: FormData): Promise<
  { ok: true; report: MonthlyReport } | { ok: false; error: string }
> {
  await requireSuperadmin();
  if (!validMonth(month)) return { ok: false, error: "Competência inválida." };
  const oversized = payloadTooLarge(form);
  if (oversized) return { ok: false, error: oversized };
  let raw: unknown;
  try { raw = JSON.parse(String(form.get("assumptions"))); } catch { return { ok: false, error: "Premissas inválidas." }; }
  const parsed = monthlyAssumptionsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Revise as premissas." };
  if (!await validAgents(tenantId, parsed.data.agentIds)) return { ok: false, error: "Selecione somente agentes deste cliente." };
  const saved = await prisma.monthlyRoiReport.findUnique({ where: { tenantId_month: { tenantId, month } }, select: { status: true } });
  if (saved?.status === "ready") return { ok: false, error: "Reabra a revisão antes de importar dados." };
  return { ok: true, report: await computeMonthlyReport(tenantId, month, false, parsed.data) };
}

export async function saveMonthlyRoi(tenantId: string, month: string, _previous: Result | null, form: FormData): Promise<Result> {
  const session = await requireSuperadmin();
  if (!validMonth(month)) return { ok: false, error: "Competência inválida." };
  const oversized = payloadTooLarge(form);
  if (oversized) return { ok: false, error: oversized };
  let raw: unknown;
  try { raw = JSON.parse(String(form.get("assumptions"))); } catch { return { ok: false, error: "Premissas inválidas." }; }
  const parsed = monthlyAssumptionsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Revise as premissas." };
  let overrides: ReturnType<typeof monthlyOverridesSchema.safeParse> | undefined;
  if (form.has("metricOverrides")) {
    try { overrides = monthlyOverridesSchema.safeParse(JSON.parse(String(form.get("metricOverrides")))); }
    catch { return { ok: false, error: "Indicadores inválidos." }; }
    if (!overrides.success) return { ok: false, error: overrides.error.issues[0]?.message ?? "Revise os indicadores." };
  }
  const text = (key: string) => String(form.get(key) ?? "").trim();
  const adjustments = text("adjustments"), nextMonth = text("nextMonth"), decisionMaker = text("decisionMaker"), featuredCase = text("featuredCase");
  const highlights = text("highlights"), limitationsNote = text("limitationsNote");
  const operationalContact = text("operationalContact"), decisionMakerRole = text("decisionMakerRole");
  if (operationalContact.length > 100 || !["", "owner", "partner"].includes(decisionMakerRole)) return { ok: false, error: "Revise o decisor e o contato operacional." };
  // Ausente no formulário = mantém as salvas (mesma regra das próximas ações).
  let agentChanges: ReportedAgentChange[] | undefined;
  if (form.has("agentChanges")) {
    let raw: unknown;
    try { raw = JSON.parse(String(form.get("agentChanges"))); } catch { return { ok: false, error: "Mudanças no agente inválidas." }; }
    const parsedChanges = agentChangesSchema.safeParse(raw);
    if (!parsedChanges.success) return { ok: false, error: parsedChanges.error.issues[0]?.message ?? "Revise as mudanças no agente." };
    agentChanges = parsedChanges.data;
  }
  // Ausente no formulário = mantém as salvas (mesma regra dos indicadores).
  let nextActions: MonthlyNextAction[] | undefined;
  if (form.has("nextActions")) {
    let raw: unknown;
    try { raw = JSON.parse(String(form.get("nextActions"))); } catch { return { ok: false, error: "Próximas ações inválidas." }; }
    const parsedActions = nextActionsSchema.safeParse(raw);
    if (!parsedActions.success) return { ok: false, error: parsedActions.error.issues[0]?.message ?? "Revise as próximas ações." };
    nextActions = parsedActions.data;
  }
  if (adjustments.length > 400 || nextMonth.length > 400 || decisionMaker.length > 100) return { ok: false, error: "Use até 400 caracteres em cada bloco e 100 no decisor para caber em uma página." };
  if (featuredCase.length > FEATURED_CASE_MAX) return { ok: false, error: `Use até ${FEATURED_CASE_MAX} caracteres no caso do mês para caber em uma página.` };
  if (highlights.length > HIGHLIGHTS_MAX || limitationsNote.length > LIMITATIONS_NOTE_MAX) return { ok: false, error: `Use até ${HIGHLIGHTS_MAX} caracteres no resumo do período e ${LIMITATIONS_NOTE_MAX} nas limitações.` };
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
  if (!tenant) return { ok: false, error: "Clínica não encontrada." };
  const actionsText = (nextActions ?? []).map((a) => `${a.action} ${a.owner} ${a.indicator}`).join(" ");
  const changesText = (agentChanges ?? []).map((c) => c.text).join(" ");
  if (featuredCase || highlights || limitationsNote || actionsText || changesText) {
    // Os textos vão para o decisor e para o PDF: nenhum contato atendido no mês
    // pode ser reconhecido pelo nome, telefone ou e-mail.
    const window = monthlyWindow(month, parsed.data.timezone);
    const contacts = await prisma.lead.findMany({ where: { tenantId, isTest: false, name: { not: null },
      conversation: { messages: { some: { createdAt: { gte: window.start, lt: window.end } } } } }, select: { name: true } });
    const names = contacts.map((c) => c.name);
    const problem = (featuredCase && featuredCaseProblem(featuredCase, names))
      || (highlights && reviewTextProblem("Resumo do período", highlights, names))
      || (limitationsNote && reviewTextProblem("Limitações do fechamento", limitationsNote, names))
      || (actionsText && reviewTextProblem("Próximas ações", actionsText, names))
      || (changesText && reviewTextProblem("O que ajustamos no agente", changesText, names));
    if (problem) return { ok: false, error: problem };
  }
  if (!await validAgents(tenantId, parsed.data.agentIds)) return { ok: false, error: "Selecione somente agentes deste cliente." };
  // Transação e filtro de status: um fechamento concorrente não pode ser sobrescrito.
  const saved = await prisma.$transaction(async (tx) => {
    const existing = await tx.monthlyRoiReport.findUnique({ where: { tenantId_month: { tenantId, month } } });
    if (existing && form.has("revision") && String(form.get("revision")) !== existing.updatedAt.toISOString()) return false;
    const metricOverrides = overrides?.success ? overrides.data : parseMonthlyOverrides(existing?.assumptions);
    const data = { assumptions: { ...parsed.data, metricOverrides }, adjustments, nextMonth, decisionMaker, featuredCase, highlights, limitationsNote,
      ...(form.has("operationalContact") ? { operationalContact } : {}), ...(form.has("decisionMakerRole") ? { decisionMakerRole } : {}),
      ...(nextActions ? { nextActions } : {}), ...(agentChanges ? { agentChanges } : {}), preparedBy: session.user.id };
    if (!existing) { await tx.monthlyRoiReport.create({ data: { tenantId, month, ...data } }); return true; }
    const updated = await tx.monthlyRoiReport.updateMany({ where: { id: existing.id, tenantId, status: "draft", updatedAt: existing.updatedAt }, data });
    return updated.count === 1;
  });
  if (!saved) return { ok: false, error: "O relatório está fechado ou mudou durante a edição. Atualize e reabra a revisão antes de alterar." };
  await recordAudit({ event: "report.monthly_saved", tenantId, target: { type: "MonthlyRoiReport", id: `${tenantId}:${month}`, label: month }, after: { assumptions: parsed.data, metricOverrides: overrides?.success ? overrides.data : undefined, adjustments, nextMonth, decisionMaker, decisionMakerRole, operationalContact, featuredCase, highlights, limitationsNote, nextActions, agentChanges } });
  invalidate(tenantId);
  return { ok: true, info: "Indicadores, premissas e revisão salvos para este mês." };
}
/**
 * Fecha a competência. Pendência não bloqueia mais: o relatório pode sair com
 * cobertura parcial, desde que o admin confirme exatamente a lista de
 * limitações que viu (`acknowledged`, de `limitationFingerprint`). Os números
 * sem evidência seguem nulos e vão congelados como "não verificado".
 */
export async function finalizeMonthlyRoi(tenantId: string, month: string, acknowledged: string[]): Promise<Result> {
  const session = await requireSuperadmin();
  if (!validMonth(month)) return { ok: false, error: "Competência inválida." };
  if (!Array.isArray(acknowledged) || acknowledged.length > 50 || !acknowledged.every((v) => typeof v === "string" && v.length <= 1000)) return { ok: false, error: "Confirmação inválida." };
  const saved = await prisma.monthlyRoiReport.findUnique({ where: { tenantId_month: { tenantId, month } } });
  if (!saved || saved.status !== "draft") return { ok: false, error: "Salve e revise o rascunho primeiro." };
  const report = await computeMonthlyReport(tenantId, month, false);
  if (report.partial) return { ok: false, error: "O mês ainda está em andamento. O fechamento fica disponível no mês seguinte." };
  const limitations = report.limitations ?? [];
  if (limitations.length && !acknowledged.length) return { ok: false, error: "Confirme as limitações do fechamento antes de fechar." };
  if (!sameLimitations(acknowledged, limitations)) return { ok: false, error: "As limitações mudaram desde a sua conferência. Revise a lista e confirme de novo." };
  if (!report.decisionMaker || !(report.adjustments || report.agentChanges?.length) || !hasNextPlan(report)) return { ok: false, error: "Preencha decisor, ajustes e as próximas ações." };
  // Número que não fecha ou decisor errado: o decisor da clínica veria.
  const blocking = report.data ? blockingIssues(validateMonthlyReport(report.data, report)) : [];
  if (blocking.length) return { ok: false, error: `${blocking[0].message} ${blocking[0].action}` };
  const finalizedAt = new Date();
  const version = (saved.version ?? 0) + 1;
  const snapshot = JSON.parse(JSON.stringify({ ...report, status: "ready", finalizedAt: finalizedAt.toISOString(), snapshotVersion: version })) as Prisma.InputJsonValue;
  // Cada fechamento vira uma versão: reabrir e fechar de novo não apaga a entregue.
  const contentHash = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  const updated = await prisma.$transaction(async (tx) => {
    const changed = await tx.monthlyRoiReport.updateMany({ where: { id: saved.id, tenantId, status: "draft", updatedAt: saved.updatedAt },
      data: { status: "ready", finalizedAt, snapshot, version } });
    if (changed.count) await tx.monthlyRoiReportVersion.create({ data: { reportId: saved.id, tenantId, version, snapshot, contentHash, finalizedBy: session.user.id, finalizedAt } });
    return changed;
  });
  if (!updated.count) return { ok: false, error: "A revisão mudou durante o fechamento. Atualize e confira novamente." };
  await recordAudit({ event: "report.monthly_finalized", tenantId, target: { type: "MonthlyRoiReport", id: saved.id, label: month }, meta: { limitations: limitations.map((l) => l.key), unverified: unverifiedMetrics(report), version, contentHash } });
  invalidate(tenantId);
  return { ok: true, info: limitations.length
    ? "Relatório fechado com cobertura parcial. As limitações e os números não verificados foram congelados para entrega."
    : "Relatório fechado. Os números e as premissas foram congelados para entrega." };
}
export async function reopenMonthlyRoi(tenantId: string, month: string): Promise<Result> {
  await requireSuperadmin();
  const saved = await prisma.monthlyRoiReport.findUnique({ where: { tenantId_month: { tenantId, month } } });
  if (!saved) return { ok: false, error: "Relatório não encontrado." };
  if (saved.sentAt) return { ok: false, error: "Relatório já enviado: o registro entregue é preservado." };
  // Ao reabrir, carregar os números que o admin estava vendo, inclusive em
  // relatórios antigos. O snapshot permanece privado como base do comparativo
  // durante a revisão e é substituído no próximo fechamento.
  const snapshot = saved.snapshot as unknown as MonthlyReport | null;
  const metricOverrides = snapshot?.version === 1 && snapshot.month === month
    ? { current: editableMonthlyMetrics(snapshot.current), previous: {} }
    : parseMonthlyOverrides(saved.assumptions);
  const assumptions = saved.assumptions as Prisma.JsonObject;
  const updated = await prisma.monthlyRoiReport.updateMany({ where: { id: saved.id, tenantId, sentAt: null, updatedAt: saved.updatedAt }, data: {
    status: "draft", finalizedAt: null, assumptions: { ...assumptions, metricOverrides },
  } });
  if (!updated.count) return { ok: false, error: "O relatório mudou durante a reabertura. Atualize e confira novamente." };
  await recordAudit({ event: "report.monthly_reopened", tenantId, target: { type: "MonthlyRoiReport", id: saved.id, label: month } });
  invalidate(tenantId); return { ok: true, info: "Revisão reaberta." };
}
export async function recordMonthlyDelivery(tenantId: string, month: string, kind: "sent" | "meeting"): Promise<Result> {
  await requireSuperadmin();
  if (!validMonth(month) || !["sent", "meeting"].includes(kind)) return { ok: false, error: "Registro inválido." };
  const saved = await prisma.monthlyRoiReport.findUnique({ where: { tenantId_month: { tenantId, month } } });
  if (!saved || saved.status !== "ready" || (kind === "meeting" && !saved.sentAt)) return { ok: false, error: "Feche e registre o envio antes da reunião." };
  const updated = await prisma.monthlyRoiReport.updateMany({ where: { id: saved.id, tenantId, status: "ready", ...(kind === "sent" ? { sentAt: null } : { meetingAt: null }) }, data: kind === "sent" ? { sentAt: new Date() } : { meetingAt: new Date() } });
  if (updated.count) await recordAudit({ event: "report.monthly_delivered", tenantId, target: { type: "MonthlyRoiReport", id: saved.id, label: month }, meta: { kind } });
  invalidate(tenantId); return { ok: true, info: kind === "sent" ? "Envio ao decisor registrado." : "Reunião realizada registrada." };
}
