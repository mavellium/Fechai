"use server";
import { prisma } from "@/lib/prisma";
import { requireSuperadmin } from "@/lib/session";
import { payloadTooLarge, rateLimit } from "@/lib/rate-limit";
import { monthKey, monthlyWindow } from "@/modules/reports/monthly-config";
import { computeMonthlyReport } from "@/modules/reports/monthly";
import { monthlyAgentSource } from "@/modules/reports/monthly-import";
import { monthlyAiDraftSchema, monthlyAiRequestSchema } from "@/modules/reports/monthly-ai";
import { answerMonthlyAi, draftMonthlyAnalysis, monthlyAiMessages, type MonthlyAiAnswer } from "@/modules/reports/monthly-ai-service";
import { createMonthlyAiToolbox } from "@/modules/reports/monthly-ai-tools";
import { draftAnalysisBase, monthlyAnalysisFacts, monthlyAnalysisMessages, monthlyAnalysisRequestSchema, type MonthlyAgentChange, type MonthlyAnalysis } from "@/modules/reports/monthly-analysis";
import { AUDIT_EVENTS } from "@/modules/audit/events";
import { appendMonthlyAiChat, clearMonthlyAiChat, loadMonthlyAiChat, type MonthlyAiChatMessage } from "@/modules/reports/monthly-ai-chat";

export async function loadMonthlyRoiAiChat(tenantId: string, month: string): Promise<MonthlyAiChatMessage[]> {
  await requireSuperadmin();
  if (monthKey(month) !== month) return [];
  return loadMonthlyAiChat(tenantId, month);
}

export async function clearMonthlyRoiAiChat(tenantId: string, month: string): Promise<{ ok: boolean }> {
  await requireSuperadmin();
  if (monthKey(month) !== month) return { ok: false };
  await clearMonthlyAiChat(tenantId, month);
  return { ok: true };
}

export async function assistMonthlyRoi(tenantId: string, month: string, form: FormData): Promise<
  { ok: true; response: MonthlyAiAnswer } | { ok: false; error: string }
> {
  const session = await requireSuperadmin();
  if (monthKey(month) !== month) return { ok: false, error: "Competência inválida." };
  const oversized = payloadTooLarge(form, 128 * 1024);
  if (oversized) return { ok: false, error: oversized };
  let raw: unknown;
  try { raw = JSON.parse(String(form.get("request"))); } catch { return { ok: false, error: "Pergunta inválida." }; }
  const request = monthlyAiRequestSchema.safeParse(raw);
  if (!request.success) return { ok: false, error: request.error.issues[0]?.message ?? "Confira os dados da revisão." };
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
  if (!tenant) return { ok: false, error: "Cliente não encontrado." };
  const ids = request.data.draft.assumptions.agentIds ?? [];
  const agents = await prisma.agent.findMany({ where: { tenantId, ...(ids.length ? { id: { in: ids } } : {}) },
    select: { id: true, name: true, isPrimary: true, archived: true, actions: { where: { tenantId, key: "schedule_meeting" }, select: { key: true, enabled: true, config: true } } } });
  if (ids.length && agents.length !== ids.length) return { ok: false, error: "Selecione somente agentes deste cliente." };
  const saved = await prisma.monthlyRoiReport.findUnique({ where: { tenantId_month: { tenantId, month } }, select: { status: true } });
  if (saved?.status === "ready") return { ok: false, error: "Reabra a revisão para usar a IA no preenchimento." };
  if (!(await rateLimit("monthly-roi-ai", session.user.id, 10, 60)).allowed) return { ok: false, error: "Aguarde um minuto antes de enviar mais perguntas." };
  try {
    const report = await computeMonthlyReport(tenantId, month, false, request.data.draft.assumptions);
    const messages = monthlyAiMessages(report, request.data, agents.map(monthlyAgentSource));
    // Ferramentas só de leitura, presas a este tenant, competência e escopo de agentes.
    const toolbox = createMonthlyAiToolbox({ tenantId, report, agents });
    const response = await answerMonthlyAi(messages, request.data.draft, toolbox);
    // Guardar o histórico é conveniência: falha aqui não pode perder a resposta que a IA já deu.
    const at = new Date().toISOString();
    await appendMonthlyAiChat(tenantId, month, session.user.id, [
      { role: "user", content: request.data.question, at },
      { role: "assistant", content: response.reply, at, provider: response.providerLabel, ...(response.changes.length ? { changes: response.changes } : {}),
        ...(response.consulted.length ? { consulted: response.consulted } : {}), ...(response.review ? { review: response.review } : {}) },
    ]).catch(() => {});
    return { ok: true, response };
  } catch (error) {
    return { ok: false, error: aiErrorMessage(error) };
  }
}

const aiErrorMessage = (error: unknown) => error instanceof Error && (error.message.startsWith("Nenhum provedor") || error.message.startsWith("A IA não conseguiu") || error.message.startsWith("A IA demorou"))
  ? error.message : "Não foi possível consultar a IA. Tente novamente.";

/** Nome do alvo que pode ir à IA: nome de agente e título de documento, nunca a pergunta de um contato. */
const SAFE_TARGET = (event: string) => event.startsWith("agent.") || ["knowledge.added", "knowledge.updated", "knowledge.deleted"].includes(event);

/**
 * Etapa 4 do fechamento: rascunho de destaques, limitações, melhorias
 * executadas e próximo mês. Não salva nada: a resposta preenche a revisão
 * aberta e a Mavellium confere antes de salvar.
 */
export async function generateMonthlyRoiAnalysis(tenantId: string, month: string, form: FormData): Promise<
  { ok: true; analysis: MonthlyAnalysis & { providerLabel: string } } | { ok: false; error: string }
> {
  const session = await requireSuperadmin();
  if (monthKey(month) !== month) return { ok: false, error: "Competência inválida." };
  const oversized = payloadTooLarge(form, 128 * 1024);
  if (oversized) return { ok: false, error: oversized };
  let raw: { draft?: unknown; context?: unknown };
  try { raw = JSON.parse(String(form.get("request"))); } catch { return { ok: false, error: "Pedido inválido." }; }
  const draft = monthlyAiDraftSchema.safeParse(raw?.draft);
  const request = monthlyAnalysisRequestSchema.safeParse({ context: raw?.context ?? "" });
  if (!draft.success || !request.success) return { ok: false, error: "Confira os dados da revisão antes de gerar a análise." };
  const ids = draft.data.assumptions.agentIds ?? [];
  if (ids.length && await prisma.agent.count({ where: { tenantId, id: { in: ids } } }) !== ids.length) return { ok: false, error: "Selecione somente agentes deste cliente." };
  const saved = await prisma.monthlyRoiReport.findUnique({ where: { tenantId_month: { tenantId, month } }, select: { status: true } });
  if (saved?.status === "ready") return { ok: false, error: "Reabra a revisão para gerar a análise." };
  if (!(await rateLimit("monthly-roi-ai", session.user.id, 10, 60)).allowed) return { ok: false, error: "Aguarde um minuto antes de gerar de novo." };
  try {
    const report = await computeMonthlyReport(tenantId, month, false, draft.data.assumptions);
    const window = monthlyWindow(month, draft.data.assumptions.timezone);
    const logs = await prisma.auditLog.findMany({
      where: { tenantId, createdAt: { gte: window.start, lt: window.end }, OR: [{ event: { startsWith: "agent." } }, { event: { startsWith: "knowledge." } }] },
      select: { event: true, targetType: true, targetId: true, targetLabel: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 500,
    });
    const grouped = new Map<string, MonthlyAgentChange>();
    for (const log of logs) {
      // Alteração em agente fora do escopo do relatório não é melhoria dele.
      if (ids.length && log.targetType === "Agent" && log.targetId && !ids.includes(log.targetId)) continue;
      const label = (AUDIT_EVENTS as Record<string, { label: string }>)[log.event]?.label;
      if (!label) continue;
      const target = SAFE_TARGET(log.event) ? log.targetLabel?.slice(0, 80) ?? null : null;
      const key = `${log.event}|${target}`;
      const row = grouped.get(key);
      if (row) row.count++; else grouped.set(key, { label, target, count: 1, lastAt: log.createdAt.toISOString() });
    }
    const changes = [...grouped.values()].slice(0, 40);
    const { limitations } = draftAnalysisBase(report, draft.data);
    // O motor de dados já calculou e validou; a IA só redige a partir disto, e
    // as travas conferem depois o que ela escreveu contra os mesmos fatos.
    const facts = monthlyAnalysisFacts(report, draft.data, changes);
    const analysis = await draftMonthlyAnalysis(monthlyAnalysisMessages(report, draft.data, changes, request.data.context), {
      limitations: limitations.length, incidents: facts.incidents.length, hasContext: Boolean(request.data.context),
      hasFacts: changes.length > 0 || Boolean(request.data.context) || Boolean(draft.data.adjustments.trim()),
      validated: `${JSON.stringify(facts)} ${request.data.context}`,
    });
    return { ok: true, analysis };
  } catch (error) {
    return { ok: false, error: aiErrorMessage(error) };
  }
}
