"use server";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSuperadmin } from "@/lib/session";
import { payloadTooLarge } from "@/lib/rate-limit";
import { monthlyAssumptionsSchema, monthKey, monthlyWindow } from "@/modules/reports/monthly-config";
import { FEATURED_CASE_MAX, featuredCaseProblem, reviewTextProblem } from "@/modules/reports/monthly-time";
import { HIGHLIGHTS_MAX, LIMITATIONS_NOTE_MAX, sameLimitations, unverifiedMetrics } from "@/modules/reports/monthly-limitations";
import { computeMonthlyReport, loadMonthlyCaseFacts, type MonthlyReport } from "@/modules/reports/monthly";
import { nextActionsSchema, type MonthlyNextAction } from "@/modules/reports/monthly-next-actions";
import { ACTION_RESULT_MAX, previousActionsSchema, reviewPreviousActions, type PreviousAction } from "@/modules/reports/monthly-previous-actions";
import { monthlyCloseProblems } from "@/modules/reports/monthly-close-check";
import type { CaseFacts } from "@/modules/reports/monthly-case";
import { ACCOUNT_OWNERS_MAX, PERSON_NAME_MAX, decisionMakerProblem, parseAccountOwners } from "@/modules/reports/monthly-decision-maker";
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
  const highlights = text("highlights"), limitationsNote = text("limitationsNote"), operationalContact = text("operationalContact");
  // Donos e sócios são da conta, não do mês. Ausente no formulário = mantém os da conta.
  let accountOwners: string[] | undefined;
  if (form.has("accountOwners")) {
    let raw: unknown;
    try { raw = JSON.parse(String(form.get("accountOwners"))); } catch { return { ok: false, error: "Donos e sócios inválidos." }; }
    if (!Array.isArray(raw) || raw.length > ACCOUNT_OWNERS_MAX || !raw.every((v) => typeof v === "string" && v.length <= PERSON_NAME_MAX)) return { ok: false, error: `Informe até ${ACCOUNT_OWNERS_MAX} donos ou sócios, com até ${PERSON_NAME_MAX} caracteres cada.` };
    accountOwners = parseAccountOwners(raw);
  }
  const decisionMakerRole = text("decisionMakerRole");
  if (!["", "owner", "partner"].includes(decisionMakerRole)) return { ok: false, error: "Revise o decisor e o contato operacional." };
  // Ausente no formulário = mantém as salvas (mesma regra das próximas ações).
  let agentChanges: ReportedAgentChange[] | undefined;
  if (form.has("agentChanges")) {
    let raw: unknown;
    try { raw = JSON.parse(String(form.get("agentChanges"))); } catch { return { ok: false, error: "Mudanças no agente inválidas." }; }
    const parsedChanges = agentChangesSchema.safeParse(raw);
    if (!parsedChanges.success) return { ok: false, error: parsedChanges.error.issues[0]?.message ?? "Revise as mudanças no agente." };
    agentChanges = parsedChanges.data;
    if (agentChanges.some((change) => change.date && !change.date.startsWith(`${month}-`))) return { ok: false, error: "A data de cada mudança deve pertencer ao mês do relatório." };
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
  if (adjustments.length > 400 || nextMonth.length > 400 || decisionMaker.length > PERSON_NAME_MAX || operationalContact.length > PERSON_NAME_MAX) return { ok: false, error: "Use até 400 caracteres em cada bloco e 100 no decisor e no contato operacional para caber em uma página." };
  if (featuredCase.length > FEATURED_CASE_MAX) return { ok: false, error: `Use até ${FEATURED_CASE_MAX} caracteres no caso do mês para caber em uma página.` };
  if (highlights.length > HIGHLIGHTS_MAX || limitationsNote.length > LIMITATIONS_NOTE_MAX) return { ok: false, error: `Use até ${HIGHLIGHTS_MAX} caracteres no resumo do período e ${LIMITATIONS_NOTE_MAX} nas limitações.` };
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, ownerNames: true } });
  if (!tenant) return { ok: false, error: "Clínica não encontrada." };
  // Rascunho pode ficar sem decisor; preenchido, já tem de ser um dono ou sócio
  // (o fechamento confere de novo, com a lista da conta naquele momento).
  if (decisionMaker) {
    const problem = decisionMakerProblem({ decisionMaker, operationalContact }, accountOwners ?? parseAccountOwners(tenant.ownerNames));
    if (problem) return { ok: false, error: problem };
  }
  const actionsText = (nextActions ?? []).map((a) => `${a.action} ${a.owner} ${a.indicator} ${a.reason ?? ""}`).join(" ");
  const changesText = (agentChanges ?? []).map((c) => `${c.text} ${c.purpose ?? ""}`).join(" ");
  if (featuredCase || highlights || limitationsNote || actionsText || changesText) {
    // Os textos vão para o decisor e para o PDF: nenhum contato atendido no mês
    // pode ser reconhecido pelo nome, telefone ou e-mail.
    const window = monthlyWindow(month, parsed.data.timezone);
    const contacts = await prisma.lead.findMany({ where: { tenantId, isTest: false, name: { not: null },
      conversation: { messages: { some: { createdAt: { gte: window.start, lt: window.end } } } } }, select: { name: true } });
    const names = contacts.map((c) => c.name);
    const problem = (featuredCase && featuredCaseProblem(featuredCase, names))
      || (highlights && reviewTextProblem("Resumo do período", highlights, names))
      || (limitationsNote && reviewTextProblem("O que não saiu como planejado", limitationsNote, names))
      || (actionsText && reviewTextProblem("Próximas ações", actionsText, names))
      || (changesText && reviewTextProblem("O que ajustamos no agente", changesText, names));
    if (problem) return { ok: false, error: problem };
  }
  if (!await validAgents(tenantId, parsed.data.agentIds)) return { ok: false, error: "Selecione somente agentes deste cliente." };
  // Fatos do caso do mês: o formulário diz só qual conversa e a idade. Duração
  // dos áudios, dia da semana e período são lidos aqui, da conversa — medidos,
  // nunca digitados. Ausente no formulário = mantém os salvos.
  let caseFacts: CaseFacts | null | undefined;
  if (form.has("caseConversationId")) {
    const conversationId = text("caseConversationId"), ageText = text("caseAge");
    const age = ageText ? Number(ageText) : null;
    if (age !== null && (!Number.isInteger(age) || age < 1 || age > 120)) return { ok: false, error: "Informe a idade do caso do mês em anos, de 1 a 120, ou deixe em branco." };
    caseFacts = conversationId ? await loadMonthlyCaseFacts(tenantId, month, parsed.data, conversationId, age) : null;
    if (conversationId && !caseFacts) return { ok: false, error: "A conversa escolhida para o caso do mês não tem áudio longo ouvido pelo agente neste mês. Escolha outra na lista." };
  }
  // Ações do mês anterior: as ações são as do relatório anterior aprovado; o
  // formulário só traz status e resultado de cada uma.
  let previousActions: PreviousAction[] | undefined;
  if (form.has("previousActions")) {
    let raw: unknown;
    try { raw = JSON.parse(String(form.get("previousActions"))); } catch { return { ok: false, error: "Ações do mês anterior inválidas." }; }
    const submitted = previousActionsSchema.safeParse(raw);
    if (!submitted.success) return { ok: false, error: `Revise as ações do mês anterior: escolha o status e use até ${ACTION_RESULT_MAX} caracteres no resultado.` };
    const before = await prisma.monthlyRoiReport.findUnique({ where: { tenantId_month: { tenantId, month: monthlyWindow(month, parsed.data.timezone).previousMonth } }, select: { status: true, snapshot: true } });
    const snapshot = before?.status === "ready" ? before.snapshot as unknown as MonthlyReport | null : null;
    previousActions = reviewPreviousActions(snapshot?.version === 1 ? snapshot.nextActions ?? [] : [], submitted.data);
    const mention = reviewTextProblem("Ações do mês anterior", previousActions.map((a) => a.result).join(" "), []);
    if (mention) return { ok: false, error: mention };
  }
  // Transação e filtro de status: um fechamento concorrente não pode ser sobrescrito.
  const saved = await prisma.$transaction(async (tx) => {
    const existing = await tx.monthlyRoiReport.findUnique({ where: { tenantId_month: { tenantId, month } } });
    if (existing && form.has("revision") && String(form.get("revision")) !== existing.updatedAt.toISOString()) return false;
    const metricOverrides = overrides?.success ? overrides.data : parseMonthlyOverrides(existing?.assumptions);
    const data = { assumptions: { ...parsed.data, metricOverrides }, adjustments, nextMonth, decisionMaker, operationalContact, featuredCase, highlights, limitationsNote,
      ...(form.has("decisionMakerRole") ? { decisionMakerRole } : {}), ...(nextActions ? { nextActions } : {}), ...(agentChanges ? { agentChanges } : {}), ...(previousActions ? { previousActions } : {}),
      ...(caseFacts !== undefined ? { caseFacts: caseFacts ?? Prisma.DbNull } : {}), preparedBy: session.user.id };
    if (!existing) await tx.monthlyRoiReport.create({ data: { tenantId, month, ...data } });
    else if ((await tx.monthlyRoiReport.updateMany({ where: { id: existing.id, tenantId, status: "draft", updatedAt: existing.updatedAt }, data })).count !== 1) return false;
    // Só com a revisão gravada: uma revisão recusada não mexe na conta.
    if (accountOwners) await tx.tenant.update({ where: { id: tenantId }, data: { ownerNames: accountOwners } });
    return true;
  });
  if (!saved) return { ok: false, error: "O relatório está fechado ou mudou durante a edição. Atualize e reabra a revisão antes de alterar." };
  await recordAudit({ event: "report.monthly_saved", tenantId, target: { type: "MonthlyRoiReport", id: `${tenantId}:${month}`, label: month }, after: { assumptions: parsed.data, metricOverrides: overrides?.success ? overrides.data : undefined, adjustments, nextMonth, decisionMaker, operationalContact, accountOwners, featuredCase, highlights, limitationsNote, nextActions, previousActions, decisionMakerRole, agentChanges,
    ...(caseFacts !== undefined ? { caseFacts: caseFacts && { ...caseFacts } } : {}) } });
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
  // O relatório vai para quem decide a mensalidade: dono ou sócio da conta, nunca a recepção.
  const account = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { ownerNames: true } });
  const editorial = monthlyCloseProblems(report, parseAccountOwners(account?.ownerNames));
  if (editorial.length) return { ok: false, error: `Na etapa 4: ${editorial[0]} Salve a revisão antes de aprovar.` };
  // Relatório v2: número que não fecha ou decisor errado, o decisor da clínica veria.
  const blocking = report.data ? blockingIssues(validateMonthlyReport(report.data, report)) : [];
  if (blocking.length) return { ok: false, error: `${blocking[0].message} ${blocking[0].action}` };
  // "O que não saiu como planejado" não é mais obrigatório: sem incidente
  // comprovado nos dados nem texto, a seção diz que não houve incidente.
  const finalizedAt = new Date();
  // Cada fechamento vira uma versão: reabrir e fechar de novo não apaga a
  // entregue, e o PDF diz de qual snapshot saiu.
  const version = (saved.version ?? 0) + 1;
  const approval = { version, approvedAt: finalizedAt.toISOString() };
  const snapshot = JSON.parse(JSON.stringify({ ...report, status: "ready", finalizedAt: finalizedAt.toISOString(), snapshotVersion: version, approval })) as Prisma.InputJsonValue;
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
  // A entrega é com o decisor congelado no fechamento. Relatório fechado antes
  // da regra pode trazer a recepção nesse campo: o envio não é registrado para
  // ela. A reunião de um relatório já enviado segue o registro entregue.
  const snapshot = saved.snapshot as unknown as MonthlyReport | null;
  const decisionMaker = (snapshot?.decisionMaker ?? saved.decisionMaker).trim();
  if (kind === "sent") {
    const account = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { ownerNames: true } });
    const problem = decisionMakerProblem({ decisionMaker, operationalContact: snapshot?.operationalContact ?? saved.operationalContact }, parseAccountOwners(account?.ownerNames));
    if (problem) return { ok: false, error: `${problem} Reabra a revisão e corrija o decisor antes de registrar o envio.` };
  }
  const updated = await prisma.monthlyRoiReport.updateMany({ where: { id: saved.id, tenantId, status: "ready", ...(kind === "sent" ? { sentAt: null } : { meetingAt: null }) }, data: kind === "sent" ? { sentAt: new Date() } : { meetingAt: new Date() } });
  if (updated.count) await recordAudit({ event: "report.monthly_delivered", tenantId, target: { type: "MonthlyRoiReport", id: saved.id, label: month }, meta: { kind, decisionMaker } });
  invalidate(tenantId); return { ok: true, info: kind === "sent" ? `Envio a ${decisionMaker} registrado.` : `Reunião com ${decisionMaker || "o decisor"} registrada.` };
}
