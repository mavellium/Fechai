import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  tenantAction: { findFirst: vi.fn(), findUnique: vi.fn() },
  appointment: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  lead: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
}));
const mirrors = vi.hoisted(() => ({ googlePush: vi.fn(), googleDelete: vi.fn(), clinicorpPush: vi.fn(), clinicorpCancel: vi.fn(), clinicorpConflict: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/modules/scheduling/google", () => ({ pushEventToGoogle: mirrors.googlePush, deleteEventFromGoogle: mirrors.googleDelete }));
vi.mock("@/modules/scheduling/clinicorp", () => ({ pushAppointmentToClinicorp: mirrors.clinicorpPush, cancelAppointmentInClinicorp: mirrors.clinicorpCancel, hasClinicorpConflict: mirrors.clinicorpConflict }));
vi.mock("@/modules/agent-engine/handoff", () => ({ addLeadToHandoffGroup: vi.fn() }));

import { getToolSchemas, runToolHandler } from "@/modules/agent-engine/tools";
import { parseScheduleConfig } from "@/modules/scheduling/config";
import { leadAppointmentsContext } from "@/modules/agent-engine/scheduling-tools";

const ctx = { tenantId: "conta-1", leadId: "cliente-1", agentId: "agente-1", conversationId: "conversa-1" };
const cfg = parseScheduleConfig({ allowCancellation: true, allowRescheduling: true, breaks: [{ label: "Almoço", startTime: "12:00", endTime: "13:00" }] });
const appointment = {
  id: "consulta-1", tenantId: ctx.tenantId, leadId: ctx.leadId, status: "scheduled",
  startsAt: new Date("2026-09-17T13:00:00Z"), endsAt: new Date("2026-09-17T13:30:00Z"),
  title: "Consulta", notes: null, googleEventId: "google-antigo", clinicorpAppointmentId: "123",
};
const cancel = (args = {}) => runToolHandler("cancel_meeting", ctx, { appointmentId: appointment.id, confirmed: true, ...args });
const reschedule = (args = {}) => runToolHandler("reschedule_meeting", ctx, { appointmentId: appointment.id, date: "2026-09-18", time: "14:00", confirmed: true, ...args });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-16T12:00:00Z"));
  db.tenantAction.findFirst.mockResolvedValue({ config: cfg });
  db.tenantAction.findUnique.mockResolvedValue({ config: cfg });
  db.appointment.findFirst.mockImplementation(async ({ where }) => where.id === appointment.id && where.tenantId === ctx.tenantId && where.leadId === ctx.leadId ? { ...appointment } : null);
  db.appointment.findMany.mockResolvedValue([appointment]);
  db.appointment.updateMany.mockResolvedValue({ count: 1 });
  db.lead.findFirst.mockResolvedValue({ name: "Cliente", phone: "5511999999999" });
  mirrors.googleDelete.mockResolvedValue(true);
  mirrors.clinicorpCancel.mockResolvedValue(true);
  mirrors.googlePush.mockResolvedValue("google-novo");
  mirrors.clinicorpPush.mockResolvedValue({ status: "synced", appointmentId: "456" });
  mirrors.clinicorpConflict.mockResolvedValue(false);
});
afterEach(() => vi.useRealTimers());

describe("permissões dentro de Agendar horário", () => {
  it("expõe cada ferramenta só com a opção habilitada e a ação principal ativa", () => {
    const names = (keys: string[], config = cfg) => getToolSchemas(keys, config).map((s) => s.name);
    expect(names([])).toEqual([]);
    expect(names(["schedule_meeting"])).toEqual(expect.arrayContaining(["list_appointments", "cancel_meeting", "reschedule_meeting"]));
    expect(names(["schedule_meeting"], { ...cfg, allowCancellation: false })).not.toContain("cancel_meeting");
    expect(names(["schedule_meeting"], { ...cfg, allowRescheduling: false })).not.toContain("reschedule_meeting");
  });
  it("recusa execução direta com a ação principal desligada", async () => {
    db.tenantAction.findFirst.mockResolvedValue(null);
    expect(await cancel()).toContain("desabilitado");
    expect(db.appointment.findFirst).not.toHaveBeenCalled();
    expect(db.tenantAction.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: ctx.tenantId, agentId: ctx.agentId, key: "schedule_meeting", enabled: true } }));
  });
  it.each(["cancel_meeting", "reschedule_meeting"])("recusa %s com a opção desligada", async (name) => {
    db.tenantAction.findFirst.mockResolvedValue({ config: { ...cfg, allowCancellation: false, allowRescheduling: false } });
    expect(await runToolHandler(name, ctx, { appointmentId: appointment.id, confirmed: true })).toContain("desabilitada");
    expect(db.appointment.updateMany).not.toHaveBeenCalled();
  });
  it("não altera consulta de outra pessoa nem outra conta", async () => {
    for (const scope of [{ ...ctx, leadId: "outro-cliente" }, { ...ctx, tenantId: "outra-conta" }]) {
      expect(await runToolHandler("cancel_meeting", scope, { appointmentId: appointment.id, confirmed: true })).toContain("não encontrada");
    }
    expect(db.appointment.updateMany).not.toHaveBeenCalled();
  });
});

describe("cancelamento", () => {
  it.each([false, undefined, "true"])("não cancela sem confirmação explícita (%s)", async (confirmed) => {
    expect(await cancel({ confirmed })).toContain("Nenhuma alteração");
    expect(db.appointment.updateMany).not.toHaveBeenCalled();
    expect(mirrors.clinicorpCancel).not.toHaveBeenCalled();
  });
  it("cancela a consulta identificada e remove seus espelhos", async () => {
    expect(await cancel()).toContain("Cancelamento feito");
    expect(db.appointment.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: ctx.tenantId, leadId: ctx.leadId, id: appointment.id, status: "scheduled" }), data: { status: "canceled" } }));
    expect(mirrors.googleDelete).toHaveBeenCalledWith(ctx.tenantId, "google-antigo");
    expect(mirrors.clinicorpCancel).toHaveBeenCalledWith(ctx.tenantId, "123");
  });
  it("repetir cancelamento não repete a alteração", async () => {
    db.appointment.findFirst.mockResolvedValue({ ...appointment, status: "canceled" });
    expect(await cancel()).toContain("já está cancelada");
    expect(db.appointment.updateMany).not.toHaveBeenCalled();
  });
});

describe("reagendamento", () => {
  it("preserva ID e duração original, liberando os espelhos anteriores", async () => {
    expect(await reschedule()).toContain("reagendada");
    expect(db.appointment.create).not.toHaveBeenCalled();
    expect(db.appointment.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({ id: appointment.id, tenantId: ctx.tenantId, leadId: ctx.leadId }),
      data: expect.objectContaining({ startsAt: new Date("2026-09-18T17:00:00Z"), endsAt: new Date("2026-09-18T17:30:00Z") }),
    }));
    expect(mirrors.clinicorpConflict).toHaveBeenCalledWith(ctx.tenantId, new Date("2026-09-18T17:00:00Z"), new Date("2026-09-18T17:30:00Z"), cfg.timezone, "123");
    expect(mirrors.clinicorpCancel).toHaveBeenCalledWith(ctx.tenantId, "123");
    expect(mirrors.clinicorpPush).toHaveBeenCalledOnce();
  });
  it("não altera horário sem confirmação", async () => {
    expect(await reschedule({ confirmed: false })).toContain("Nenhuma alteração");
    expect(db.appointment.updateMany).not.toHaveBeenCalled();
  });
  it.each(["11:45", "12:00", "18:00"])("preserva original quando %s atravessa pausa ou fechamento", async (time) => {
    expect(await reschedule({ time })).toContain("original continua reservado");
    expect(db.appointment.updateMany).not.toHaveBeenCalled();
  });
  it("preserva original em conflito local", async () => {
    db.appointment.findFirst.mockImplementation(async ({ where }) => where.id === appointment.id ? appointment : { id: "outra-consulta" });
    expect(await reschedule()).toContain("ocupado");
    expect(db.appointment.updateMany).not.toHaveBeenCalled();
    expect(mirrors.clinicorpCancel).not.toHaveBeenCalled();
  });
  it("preserva original em conflito no Clinicorp", async () => {
    mirrors.clinicorpConflict.mockResolvedValue(true);
    expect(await reschedule()).toContain("ocupado");
    expect(db.appointment.updateMany).not.toHaveBeenCalled();
  });
  it("não desfaz reagendamento local quando o novo espelho falha", async () => {
    mirrors.clinicorpPush.mockResolvedValue({ status: "failed", error: "indisponível" });
    expect(await reschedule()).toContain("Reagendado no fechai");
    expect(db.appointment.updateMany).toHaveBeenCalled();
  });
  it("não duplica espelhos se a remoção anterior falhar e preserva seus IDs", async () => {
    mirrors.googleDelete.mockResolvedValue(false);
    mirrors.clinicorpCancel.mockResolvedValue(false);
    expect(await reschedule()).toContain("Reagendado no fechai");
    expect(mirrors.googlePush).not.toHaveBeenCalled();
    expect(mirrors.clinicorpPush).not.toHaveBeenCalled();
    expect(db.appointment.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: { googleEventId: "google-antigo", clinicorpAppointmentId: "123" } }));
  });
  it("não altera consulta que mudou durante a operação", async () => {
    db.appointment.updateMany.mockResolvedValue({ count: 0 });
    expect(await reschedule()).toContain("mudou");
    expect(mirrors.clinicorpCancel).not.toHaveBeenCalled();
    expect(mirrors.googlePush).not.toHaveBeenCalled();
  });
});

describe("retorno de contato com consulta", () => {
  it("consulta o contato na conta, sem depender do histórico da conversa", async () => {
    expect(await leadAppointmentsContext(ctx, cfg)).toContain(appointment.id);
    expect(db.appointment.findMany).toHaveBeenCalledWith({ where: { tenantId: ctx.tenantId, leadId: ctx.leadId, status: "scheduled", startsAt: { gte: expect.any(Date) } }, orderBy: { startsAt: "asc" } });
  });
  it("não cria duplicata para confirmar ou contornar reagendamento", async () => {
    expect(await runToolHandler("schedule_meeting", ctx, { date: "2026-09-18", time: "14:00" })).toContain("já tem consulta");
    expect(db.appointment.create).not.toHaveBeenCalled();
  });
});
