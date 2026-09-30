"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSuperadmin } from "@/lib/session";
import { payloadTooLarge } from "@/lib/rate-limit";
import { monthKey } from "@/modules/reports/monthly-config";
import { askedFromClinic, isPendencyTopic, PENDENCY_ANSWER_MAX, PENDENCY_ASSIGNEE_MAX } from "@/modules/reports/monthly-pendencies";
import { recordAudit } from "@/modules/audit/log";

type Result = { ok: boolean; error?: string; info?: string };
const VIAS = ["whatsapp", "email", "copy"] as const;

/** Registrar pendência não muda número: a resposta é aplicada à mão na revisão. */
async function assertOpen(tenantId: string, month: string): Promise<string | null> {
  if (monthKey(month) !== month) return "Competência inválida.";
  const [tenant, report] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } }),
    prisma.monthlyRoiReport.findUnique({ where: { tenantId_month: { tenantId, month } }, select: { status: true } }),
  ]);
  if (!tenant) return "Clínica não encontrada.";
  if (report?.status === "ready") return "O relatório está fechado. Reabra a revisão para mexer nas pendências.";
  return null;
}

export async function saveMonthlyPendency(tenantId: string, month: string, topic: string, _previous: Result | null, form: FormData): Promise<Result> {
  const session = await requireSuperadmin();
  if (!isPendencyTopic(topic)) return { ok: false, error: "Pendência inválida." };
  const oversized = payloadTooLarge(form);
  if (oversized) return { ok: false, error: oversized };
  const assignee = String(form.get("assignee") ?? "").trim(), answer = String(form.get("answer") ?? "").trim();
  if (assignee.length > PENDENCY_ASSIGNEE_MAX) return { ok: false, error: `Use até ${PENDENCY_ASSIGNEE_MAX} caracteres no responsável.` };
  if (answer.length > PENDENCY_ANSWER_MAX) return { ok: false, error: `Use até ${PENDENCY_ANSWER_MAX} caracteres na resposta.` };
  const closed = await assertOpen(tenantId, month);
  if (closed) return { ok: false, error: closed };
  const where = { tenantId_month_topic: { tenantId, month, topic } };
  const existing = await prisma.monthlyRoiPendency.findUnique({ where, select: { answer: true, answeredAt: true } });
  // A data é da resposta, não do último clique em salvar: só muda quando o texto muda.
  const answeredAt = answer === (existing?.answer ?? "") ? existing?.answeredAt ?? null : answer ? new Date() : null;
  await prisma.monthlyRoiPendency.upsert({ where,
    create: { tenantId, month, topic, assignee, answer, answeredAt, updatedBy: session.user.id },
    update: { assignee, answer, answeredAt, updatedBy: session.user.id } });
  await recordAudit({ event: "report.monthly_pendency_updated", tenantId, target: { type: "MonthlyRoiPendency", id: `${tenantId}:${month}:${topic}`, label: month },
    meta: { topic, assigned: Boolean(assignee), answered: Boolean(answer) } });
  revalidatePath(`/admin/relatorios/${tenantId}`);
  return { ok: true, info: answer && answer !== existing?.answer ? "Resposta registrada. Aplique o dado na revisão e salve para recalcular." : "Pendência atualizada." };
}

/** Marca como pedidos à clínica os tópicos que foram na mensagem consolidada. */
export async function recordMonthlyPendencyRequest(tenantId: string, month: string, topics: string[], via: string): Promise<Result> {
  const session = await requireSuperadmin();
  if (!(VIAS as readonly string[]).includes(via)) return { ok: false, error: "Canal inválido." };
  const valid = Array.isArray(topics) && topics.length > 0 && topics.length <= 20 && new Set(topics).size === topics.length
    && topics.every((t) => typeof t === "string" && isPendencyTopic(t) && askedFromClinic(t));
  if (!valid) return { ok: false, error: "Nada a solicitar à clínica." };
  const closed = await assertOpen(tenantId, month);
  if (closed) return { ok: false, error: closed };
  const requestedAt = new Date();
  await prisma.$transaction(topics.map((topic) => prisma.monthlyRoiPendency.upsert({
    where: { tenantId_month_topic: { tenantId, month, topic } },
    create: { tenantId, month, topic, requestedAt, requestedVia: via, updatedBy: session.user.id },
    update: { requestedAt, requestedVia: via, updatedBy: session.user.id },
  })));
  await recordAudit({ event: "report.monthly_pendencies_requested", tenantId, target: { type: "MonthlyRoiReport", id: `${tenantId}:${month}`, label: month }, meta: { topics, via } });
  revalidatePath(`/admin/relatorios/${tenantId}`);
  return { ok: true, info: `Solicitação registrada: ${topics.length} ${topics.length === 1 ? "pendência aguardando" : "pendências aguardando"} a clínica.` };
}
