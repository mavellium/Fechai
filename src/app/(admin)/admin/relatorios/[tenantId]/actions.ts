"use server";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSuperadmin } from "@/lib/session";
import { payloadTooLarge } from "@/lib/rate-limit";
import { monthlyAssumptionsSchema, monthKey } from "@/modules/reports/monthly-config";
import { computeMonthlyReport } from "@/modules/reports/monthly";
import { recordAudit } from "@/modules/audit/log";

type Result = { ok: boolean; error?: string; info?: string };
function invalidate(tenantId: string) {
  revalidatePath(`/admin/relatorios/${tenantId}`);
  revalidatePath("/admin/relatorios");
  revalidatePath("/relatorios");
}
function validMonth(month: string) { return monthKey(month) === month; }
export async function saveMonthlyRoi(tenantId: string, month: string, _previous: Result | null, form: FormData): Promise<Result> {
  const session = await requireSuperadmin();
  if (!validMonth(month)) return { ok: false, error: "Competência inválida." };
  const oversized = payloadTooLarge(form);
  if (oversized) return { ok: false, error: oversized };
  let raw: unknown;
  try { raw = JSON.parse(String(form.get("assumptions"))); } catch { return { ok: false, error: "Premissas inválidas." }; }
  const parsed = monthlyAssumptionsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Revise as premissas." };
  const text = (key: string) => String(form.get(key) ?? "").trim();
  const adjustments = text("adjustments"), nextMonth = text("nextMonth"), decisionMaker = text("decisionMaker");
  if (adjustments.length > 400 || nextMonth.length > 400 || decisionMaker.length > 100) return { ok: false, error: "Use até 400 caracteres em cada bloco e 100 no decisor para caber em uma página." };
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
  if (!tenant) return { ok: false, error: "Clínica não encontrada." };
  // Transação e filtro de status: um fechamento concorrente não pode ser sobrescrito.
  const saved = await prisma.$transaction(async (tx) => {
    const existing = await tx.monthlyRoiReport.findUnique({ where: { tenantId_month: { tenantId, month } } });
    const data = { assumptions: parsed.data, adjustments, nextMonth, decisionMaker, preparedBy: session.user.id };
    if (!existing) { await tx.monthlyRoiReport.create({ data: { tenantId, month, ...data } }); return true; }
    const updated = await tx.monthlyRoiReport.updateMany({ where: { id: existing.id, tenantId, status: "draft" }, data });
    return updated.count === 1;
  });
  if (!saved) return { ok: false, error: "O relatório está fechado. Reabra a revisão antes de alterar." };
  await recordAudit({ event: "report.monthly_saved", tenantId, target: { type: "MonthlyRoiReport", id: `${tenantId}:${month}`, label: month }, after: { assumptions: parsed.data, adjustments, nextMonth, decisionMaker } });
  invalidate(tenantId);
  return { ok: true, info: "Premissas e revisão salvas para este mês." };
}
export async function finalizeMonthlyRoi(tenantId: string, month: string, acknowledgePartial: boolean): Promise<Result> {
  await requireSuperadmin();
  if (!validMonth(month)) return { ok: false, error: "Competência inválida." };
  const saved = await prisma.monthlyRoiReport.findUnique({ where: { tenantId_month: { tenantId, month } } });
  if (!saved || saved.status !== "draft") return { ok: false, error: "Salve e revise o rascunho primeiro." };
  const report = await computeMonthlyReport(tenantId, month, false);
  if (report.partial) return { ok: false, error: "O mês ainda está em andamento. O fechamento fica disponível no mês seguinte." };
  if (report.current.missing.length) return { ok: false, error: "Resolva as pendências dos dados e das premissas antes de fechar." };
  if (!report.current.trackingComplete && !acknowledgePartial) return { ok: false, error: "Confirme a cobertura parcial dos eventos históricos." };
  if (!report.decisionMaker || !report.adjustments || !report.nextMonth) return { ok: false, error: "Preencha decisor, ajustes e próximo mês." };
  const finalizedAt = new Date();
  const updated = await prisma.monthlyRoiReport.updateMany({ where: { id: saved.id, tenantId, status: "draft", updatedAt: saved.updatedAt },
    data: { status: "ready", finalizedAt, snapshot: JSON.parse(JSON.stringify({ ...report, status: "ready", finalizedAt: finalizedAt.toISOString() })) as Prisma.InputJsonValue } });
  if (!updated.count) return { ok: false, error: "A revisão mudou durante o fechamento. Atualize e confira novamente." };
  await recordAudit({ event: "report.monthly_finalized", tenantId, target: { type: "MonthlyRoiReport", id: saved.id, label: month }, meta: { acknowledgePartial } });
  invalidate(tenantId);
  return { ok: true, info: "Relatório fechado. Os números e as premissas foram congelados para entrega." };
}
export async function reopenMonthlyRoi(tenantId: string, month: string): Promise<Result> {
  await requireSuperadmin();
  const saved = await prisma.monthlyRoiReport.findUnique({ where: { tenantId_month: { tenantId, month } } });
  if (!saved) return { ok: false, error: "Relatório não encontrado." };
  if (saved.sentAt) return { ok: false, error: "Relatório já enviado: o registro entregue é preservado." };
  await prisma.monthlyRoiReport.updateMany({ where: { id: saved.id, tenantId, sentAt: null }, data: { status: "draft", snapshot: Prisma.DbNull, finalizedAt: null } });
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
