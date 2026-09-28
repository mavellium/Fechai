"use server";
import { prisma } from "@/lib/prisma";
import { requireSuperadmin } from "@/lib/session";
import { payloadTooLarge, rateLimit } from "@/lib/rate-limit";
import { monthKey } from "@/modules/reports/monthly-config";
import { computeMonthlyReport } from "@/modules/reports/monthly";
import { monthlyAgentSource } from "@/modules/reports/monthly-import";
import { monthlyAiRequestSchema, type MonthlyAiResponse } from "@/modules/reports/monthly-ai";
import { answerMonthlyAi, monthlyAiMessages } from "@/modules/reports/monthly-ai-service";

export async function assistMonthlyRoi(tenantId: string, month: string, form: FormData): Promise<
  { ok: true; response: MonthlyAiResponse & { providerLabel: string } } | { ok: false; error: string }
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
    select: { id: true, name: true, isPrimary: true, archived: true, actions: { where: { tenantId, key: "schedule_meeting" }, select: { key: true, config: true } } } });
  if (ids.length && agents.length !== ids.length) return { ok: false, error: "Selecione somente agentes deste cliente." };
  const saved = await prisma.monthlyRoiReport.findUnique({ where: { tenantId_month: { tenantId, month } }, select: { status: true } });
  if (saved?.status === "ready") return { ok: false, error: "Reabra a revisão para usar a IA no preenchimento." };
  if (!(await rateLimit("monthly-roi-ai", session.user.id, 10, 60)).allowed) return { ok: false, error: "Aguarde um minuto antes de enviar mais perguntas." };
  try {
    const report = await computeMonthlyReport(tenantId, month, false, request.data.draft.assumptions);
    const messages = monthlyAiMessages(report, request.data, agents.map(monthlyAgentSource));
    return { ok: true, response: await answerMonthlyAi(messages, request.data.draft) };
  } catch (error) {
    return { ok: false, error: error instanceof Error && (error.message.startsWith("Nenhum provedor") || error.message.startsWith("A IA não conseguiu") || error.message.startsWith("A IA demorou")) ? error.message : "Não foi possível consultar a IA. Tente novamente." };
  }
}
