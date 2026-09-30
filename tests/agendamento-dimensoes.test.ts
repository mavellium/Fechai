import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  appointment: { findFirst: vi.fn(), updateMany: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import {
  attendanceOf, canConfirm, canMarkAttendance, originHours, parseKind, situationOf, sourceOf,
} from "@/modules/scheduling/dimensions";
import { setAppointmentAttendance, setAppointmentConfirmed } from "@/modules/scheduling/repository";
import { evaluateMonthlyMetrics, type MonthlyAppointment } from "@/modules/reports/monthly";
import type { ClinicorpReportData } from "@/modules/scheduling/clinicorp";
import { roiAppointment, roiInput } from "./fixtures/monthly-roi";

const NOW = new Date("2026-09-30T15:00:00Z");
const PAST = new Date("2026-09-29T15:00:00Z");
const FUTURE = new Date("2026-10-01T15:00:00Z");

describe("dimensões do agendamento (puras)", () => {
  it("tipo só de valor conhecido, sem acento nem caixa; o resto é não classificado", () => {
    expect(parseKind("Avaliação")).toBe("evaluation");
    expect(parseKind("avaliacao")).toBe("evaluation");
    expect(parseKind("RETORNO")).toBe("return");
    expect(parseKind("procedimento")).toBe("procedure");
    expect(parseKind("Implante")).toBeNull();
    expect(parseKind("Reavaliação")).toBeNull();
    expect(parseKind(undefined)).toBeNull();
  });

  it("comparecimento nasce não verificado; o legado done é lido como compareceu", () => {
    expect(attendanceOf({ status: "scheduled", attendance: "unknown" })).toBe("unknown");
    expect(attendanceOf({ status: "scheduled", attendance: null })).toBe("unknown");
    expect(attendanceOf({ status: "scheduled", attendance: "lixo" })).toBe("unknown");
    expect(attendanceOf({ status: "done", attendance: "unknown" })).toBe("attended");
    expect(attendanceOf({ status: "scheduled", attendance: "no_show" })).toBe("no_show");
  });

  it("situação: cancelada vence remarcada", () => {
    expect(situationOf({ status: "scheduled", rescheduledAt: null })).toBe("scheduled");
    expect(situationOf({ status: "scheduled", rescheduledAt: PAST })).toBe("rescheduled");
    expect(situationOf({ status: "canceled", rescheduledAt: PAST })).toBe("canceled");
    expect(sourceOf("manual")).toBe("manual");
    expect(sourceOf("integration")).toBe("integration");
    expect(sourceOf("qualquer")).toBe("manual");
  });

  it("comparecimento só depois do horário e fora de cancelada; confirmar só antes", () => {
    expect(canMarkAttendance({ status: "scheduled", startsAt: FUTURE }, NOW)).toBe(false);
    expect(canMarkAttendance({ status: "scheduled", startsAt: PAST }, NOW)).toBe(true);
    expect(canMarkAttendance({ status: "canceled", startsAt: PAST }, NOW)).toBe(false);
    expect(canConfirm({ status: "scheduled", startsAt: FUTURE }, NOW)).toBe(true);
    expect(canConfirm({ status: "scheduled", startsAt: PAST }, NOW)).toBe(false);
    expect(canConfirm({ status: "canceled", startsAt: FUTURE }, NOW)).toBe(false);
  });

  it("horário de origem sem expediente ou sem chegada anterior é não classificado, nunca dentro", () => {
    const created = new Date("2026-09-14T15:00:00Z");
    const arrival = new Date("2026-09-14T10:00:00Z");
    expect(originHours(arrival, created, () => null)).toBe("unclassified");
    expect(originHours(null, created, () => false)).toBe("unclassified");
    expect(originHours(new Date("2026-09-15T10:00:00Z"), created, () => false)).toBe("unclassified");
    expect(originHours(arrival, created, () => true)).toBe("outside");
    expect(originHours(arrival, created, () => false)).toBe("inside");
  });
});

describe("relatório mensal: agendar ou confirmar nunca é comparecer", () => {
  const run = (appointment: Partial<MonthlyAppointment>, clinicorp?: ClinicorpReportData) => {
    const input = roiInput();
    return evaluateMonthlyMetrics({
      ...input,
      appointments: [{ ...roiAppointment(), ...appointment }],
      ...(clinicorp ? { clinicorp } : {}),
    }).metrics;
  };
  const total = (split: { inside: number; outside: number; unclassified: number }) => split.inside + split.outside + split.unclassified;

  it("consulta só agendada (sem marcação) fica pendente, não realizada", () => {
    const m = run({ status: "scheduled", attendance: "unknown" });
    expect(total(m.attended)).toBe(0);
    expect(m.attendanceUnknown).toBe(1);
    expect(total(m.scheduled)).toBe(1);
  });

  it("compareceu conta; faltou não conta e não fica pendente", () => {
    expect(total(run({ status: "scheduled", attendance: "attended", attendanceAt: PAST }).attended)).toBe(1);
    const noShow = run({ status: "scheduled", attendance: "no_show", attendanceAt: PAST });
    expect(total(noShow.attended)).toBe(0);
    expect(noShow.attendanceUnknown).toBe(0);
  });

  it("tipo explícito vence o nome do serviço", () => {
    const retorno = run({ kind: "return", serviceType: "Avaliação", status: "scheduled", attendance: "attended", attendanceAt: PAST });
    expect(total(retorno.scheduled)).toBe(0);
    expect(total(retorno.attended)).toBe(0);
    const semNome = run({ kind: "evaluation", serviceType: null, status: "scheduled", attendance: "attended", attendanceAt: PAST });
    expect(total(semNome.attended)).toBe(1);
    expect(semNome.untypedAppointments).toBe(0);
  });

  it("procedimento registrado na consulta vence a variável da conversa", () => {
    const m = run({ procedure: "Clareamento", status: "scheduled", attendance: "attended", attendanceAt: PAST });
    expect(m.procedures.find((p) => p.name === "Clareamento")?.attendedOutside).toBe(1);
    expect(m.procedures.find((p) => p.name === "Implante")?.attendedOutside ?? 0).toBe(0);
  });

  it("com espelho no Clinicorp: status de lá vence; sem resposta de lá, só a marcação datada vale", () => {
    const linked = { clinicorpAppointmentId: "123" };
    const semResposta: ClinicorpReportData = { available: true, integrationState: "configured", error: null,
      appointments: [{ id: "123", statusType: null, canceled: false }], statusTypes: [] };
    const naoRealizado: ClinicorpReportData = { ...semResposta, appointments: [{ id: "123", statusType: "AGENDADO", canceled: false }] };

    expect(total(run({ ...linked, status: "scheduled", attendance: "attended", attendanceAt: PAST }, semResposta).attended)).toBe(1);
    // Legado `done` (sem data de marcação) segue dependendo do Clinicorp.
    expect(run({ ...linked, status: "done" }, semResposta).attendanceUnknown).toBe(1);
    expect(total(run({ ...linked, status: "scheduled", attendance: "attended", attendanceAt: PAST }, naoRealizado).attended)).toBe(0);
  });
});

describe("marcações no repository", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    db.appointment.updateMany.mockResolvedValue({ count: 1 });
  });

  it("recusa comparecimento antes do horário, sem gravar", async () => {
    db.appointment.findFirst.mockResolvedValue({ status: "scheduled", startsAt: FUTURE });
    expect(await setAppointmentAttendance("t1", "a1", "attended", NOW)).toBe("not_allowed");
    expect(db.appointment.updateMany).not.toHaveBeenCalled();
  });

  it("grava comparecimento com a trava de horário e de tenant no WHERE", async () => {
    db.appointment.findFirst.mockResolvedValue({ status: "done", startsAt: PAST });
    expect(await setAppointmentAttendance("t1", "a1", "no_show", NOW)).toBe("ok");
    expect(db.appointment.updateMany).toHaveBeenCalledWith({
      where: { id: "a1", tenantId: "t1", status: { in: ["scheduled", "done"] }, startsAt: { lte: NOW } },
      data: { status: "scheduled", attendance: "no_show", attendanceSource: "human", attendanceAt: NOW },
    });
  });

  it("desfazer volta a não verificado sem origem nem data", async () => {
    db.appointment.findFirst.mockResolvedValue({ status: "scheduled", startsAt: PAST });
    await setAppointmentAttendance("t1", "a1", "unknown", NOW);
    expect(db.appointment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: "scheduled", attendance: "unknown", attendanceSource: null, attendanceAt: null },
    }));
  });

  it("confirmar não toca em comparecimento e só vale para consulta futura de pé", async () => {
    db.appointment.findFirst.mockResolvedValue({ status: "scheduled", startsAt: FUTURE });
    expect(await setAppointmentConfirmed("t1", "a1", true, NOW)).toBe("ok");
    expect(db.appointment.updateMany).toHaveBeenCalledWith({
      where: { id: "a1", tenantId: "t1", status: "scheduled", startsAt: { gt: NOW } },
      data: { confirmedAt: NOW, confirmationSource: "human" },
    });

    db.appointment.findFirst.mockResolvedValue({ status: "scheduled", startsAt: PAST });
    expect(await setAppointmentConfirmed("t1", "a1", true, NOW)).toBe("not_allowed");
  });

  it("consulta de outra conta não é encontrada", async () => {
    db.appointment.findFirst.mockResolvedValue(null);
    expect(await setAppointmentAttendance("t1", "a1", "attended", NOW)).toBe("not_found");
    expect(db.appointment.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "a1", tenantId: "t1" } }));
  });
});
