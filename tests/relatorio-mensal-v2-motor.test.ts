import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/modules/scheduling/clinicorp", () => ({ readClinicorpReport: vi.fn() }));
import { evaluateMonthlyMetrics, type MonthlyAppointment, type MonthlyConversation, type MonthlyInput } from "@/modules/reports/monthly";
import { monthlyWindow } from "@/modules/reports/monthly-config";
import { cohortStatusOf, median, monthlyComparison, type Split } from "@/modules/reports/monthly-data";
import { local, v2Config, v2Input } from "./fixtures/monthly-report-v2";

const data = (input: MonthlyInput = v2Input()) => evaluateMonthlyMetrics(input).data;
const parts = (s: Split) => [s.inside.value, s.outside.value, s.total.value];

function contact(id: string, at: Date, reply: "agent" | "human" | null = "agent"): MonthlyConversation {
  return { id, leadId: id, variables: {}, lead: { createdAt: at }, firstInbound: at,
    messages: [{ id: `${id}-in`, role: "user", sentBy: null, createdAt: at },
      ...(reply ? [{ id: `${id}-re`, role: "assistant", sentBy: reply, createdAt: new Date(at.getTime() + 40_000) }] : [])] };
}
function evaluation(id: string, conversationId: string, over: Partial<MonthlyAppointment> = {}): MonthlyAppointment {
  return { id, conversationId, leadId: conversationId, source: "agent", serviceType: "Avaliação", kind: "evaluation", status: "scheduled",
    createdAt: local(10, 10), startsAt: local(20, 10), clinicorpAppointmentId: null, attendance: "unknown", attendanceAt: null, ...over };
}
function small(conversations: MonthlyConversation[], appointments: MonthlyAppointment[] = []): MonthlyInput {
  return { ...v2Input(), conversations, appointments, events: [], uptime: undefined };
}

describe("relatório mensal v2 - fixture de aceite", () => {
  const d = data();
  it("contatos: todos entram, com a quebra por expediente", () => {
    expect(parts(d.service.contacts)).toEqual([126, 88, 214]);
    expect(d.service.hourBands.map((b) => b.contacts)).toEqual([14, 46, 22, 58, 52, 22]);
  });
  it("só agente + transferidas = contatos", () => {
    expect(d.service.aiOnly.value).toBe(156);
    expect(d.service.transferred.value).toBe(58);
  });
  it("primeira resposta: mediana, só da IA, separada da recepção", () => {
    expect(d.service.agentFirstResponseSeconds.value).toBe(38);
    expect(d.service.reception.answered.value).toBe(55);
    expect(d.service.reception.firstResponseSeconds.value).toBe(22 * 60);
    expect(d.service.reception.waitedOverHour.value).toBe(11);
    expect(d.service.reception.unanswered.value).toBe(3);
  });
  it("disponibilidade vem das quedas medidas pelo monitor do WhatsApp", () => {
    // 3h fora em 720h: arredonda para baixo, queda nunca vira 100%.
    expect(d.service.availabilityPercent).toMatchObject({ value: 99.5, status: "measured" });
    expect(d.incidents).toEqual([expect.objectContaining({ seconds: 10_800, contacts: 4 })]);
  });
  it("tempo devolvido: áudio medido, texto estimado", () => {
    const t = d.service.time;
    expect(t.audios.value).toBe(37);
    expect(t.audioSeconds.value).toBe(2 * 3600 + 5 * 60);
    expect(t.longestAudioSeconds.value).toBe(6 * 60 + 12);
    expect(t.longAudios.value).toBe(14);
    expect(t.textMessages.value).toBe(910);
    expect(t.textSeconds).toMatchObject({ value: 7 * 3600 + 35 * 60, status: "estimated" });
    expect(t.totalSeconds).toMatchObject({ value: 9 * 3600 + 40 * 60, status: "estimated" });
  });
  it("agenda: qualificados e a coorte das avaliações marcadas no mês", () => {
    expect(parts(d.schedule.qualified)).toEqual([56, 41, 97]);
    expect(parts(d.schedule.cohort.attended)).toEqual([13, 8, 21]);
    expect(parts(d.schedule.cohort.no_show)).toEqual([4, 2, 6]);
    expect(parts(d.schedule.cohort.upcoming)).toEqual([2, 1, 3]);
    expect(parts(d.schedule.cohort.unverified)).toEqual([0, 1, 1]);
    expect(parts(d.schedule.cohort.total)).toEqual([19, 12, 31]);
    expect(d.schedule.attendanceRatePercent).toMatchObject({ value: 78, status: "confirmed" });
    expect(d.schedule.fromEarlierMonths.attended.value).toBe(2);
    expect(d.schedule.fromEarlierMonths.noShow.value).toBe(0);
    expect(d.schedule.procedures).toEqual([{ name: "Implante", scheduled: 11 }, { name: "Ortodontia / alinhador", scheduled: 8 },
      { name: "Avaliação geral", scheduled: 7 }, { name: "Clareamento", scheduled: 5 }]);
  });
  it("perguntas sem resposta", () => expect(d.unanswered.value).toBe(14));
  it("qualidade dos leads: cidade, dúvida e um motivo por contato que não agendou", () => {
    expect(d.leads.withCity.value).toBe(133);
    expect(d.leads.outOfArea.value).toBe(29);
    expect(d.leads.outOfAreaScheduled.value).toBe(1);
    expect(d.leads.firstDoubts.map((x) => [x.key, x.percent])).toEqual([["preco", 34], ["localizacao", 21], ["convenio", 18], ["horario", 12], ["outros", 15]]);
    expect(d.leads.reasons.map((x) => [x.key, x.contacts])).toEqual([["sumiu", 112], ["preco", 29], ["fora_da_regiao", 17], ["adiou", 14], ["outros", 11]]);
    expect(d.leads.reasons.reduce((n, x) => n + x.contacts, 0)).toBe(214 - 31);
    expect(d.schedule.scheduledContacts).toBe(31);
  });
  it("problemas: só o que os dados comprovam", () => {
    expect(d.problems).toEqual([
      { kind: "no_show", count: 6, ratePercent: 22 },
      expect.objectContaining({ kind: "outage", minutes: 180, contactsAffected: 4 }),
      { kind: "reception_wait", waitedOverHour: 11, unanswered: 3 },
    ]);
  });
  it("retorno estimado: receita só de quem chegou com a recepção fechada", () => {
    const r = d.estimatedReturn!;
    expect(r.attendedOutside).toBe(8);
    expect(r.revenueCents).toBe(896_000);
    expect(Math.round(r.savingsCents / 100)).toBe(242);
    expect(r.investmentCents).toBe(149_000);
    expect(Math.round(r.netCents / 100)).toBe(7712);
    expect(r.multiple).toBe(5.2);
  });
  it("sem premissa, o retorno estimado não existe (D4)", () => {
    const input = v2Input();
    input.config.procedures = [];
    expect(data(input).estimatedReturn).toBeNull();
    const noTeam = v2Input();
    noTeam.config.attendantMonthlyCents = null;
    const without = data(noTeam);
    expect(without.estimatedReturn).toBeNull();
    // O resto do relatório não depende das premissas financeiras.
    expect(parts(without.service.contacts)).toEqual([126, 88, 214]);
  });
});

describe("relatório mensal v2 - fuso e expediente", () => {
  it("23:30 de 30/09 em Brasília conta em setembro; 00:10 de 01/10, em outubro", () => {
    const conversations = [contact("set", local(30, 23, 30)), contact("out", local(1, 0, 10, 0, 10))];
    expect(data(small(conversations)).service.contacts.total.value).toBe(1);
    const october = monthlyWindow("2026-10", "America/Sao_Paulo");
    expect(data({ ...small(conversations), start: october.start, end: october.end }).service.contacts.total.value).toBe(1);
  });
  it("classifica pelo expediente cadastrado, nunca por faixa fixa", () => {
    // 19/09 é sábado; 21/09, segunda.
    const bucket = (at: Date) => parts(data(small([contact("x", at)])).service.contacts);
    expect(bucket(local(19, 13))).toEqual([0, 1, 1]);
    expect(bucket(local(19, 11))).toEqual([1, 0, 1]);
    expect(bucket(local(21, 7, 59))).toEqual([0, 1, 1]);
    expect(bucket(local(21, 8, 0))).toEqual([1, 0, 1]);
  });
  it("sem expediente cadastrado, mostra só o total", () => {
    const input = small([contact("x", local(21, 9))]);
    input.config.humanHours = null;
    const split = data(input).service.contacts;
    expect(split.total.value).toBe(1);
    expect(split.inside).toMatchObject({ value: null, status: "partial" });
    expect(data(input).estimatedReturn).toBeNull();
  });
  it("contato sem resposta não é contato atendido; só a equipe respondendo é transferido", () => {
    const d = data(small([contact("a", local(21, 9)), contact("b", local(21, 9), "human"), contact("c", local(21, 9), null)]));
    expect(d.service.contacts.total.value).toBe(2);
    expect(d.service.transferred.value).toBe(1);
    expect(d.service.aiOnly.value).toBe(1);
    // A resposta da equipe não entra na mediana do agente.
    expect(d.service.agentFirstResponseSeconds.value).toBe(40);
  });
  it("sem medição da conexão, a disponibilidade fica indisponível (não 100%)", () => {
    expect(data(small([contact("a", local(21, 9))])).service.availabilityPercent).toMatchObject({ value: null, status: "unavailable" });
    // Monitorada só a partir do meio do mês: o número vale, com o selo de parcial.
    const half = { ...small([contact("a", local(21, 9))]), uptime: { trackedSince: local(15, 0), incidents: [] } };
    expect(data(half).service.availabilityPercent).toMatchObject({ value: 100, status: "partial" });
  });
});

describe("relatório mensal v2 - coorte de agendamentos", () => {
  const conversations = [contact("a", local(10, 9))];
  it("criada em 30/09 para 03/10 aguarda consulta", () => {
    const d = data(small(conversations, [evaluation("x", "a", { createdAt: local(30, 10), startsAt: local(3, 10, 0, 0, 10) })]));
    expect(d.schedule.cohort.upcoming.total.value).toBe(1);
    expect(d.problems).toEqual([]);
  });
  it("criada em 28/08 e realizada em 02/09 vai para a linha de meses anteriores", () => {
    const d = data(small(conversations, [evaluation("x", "a", { createdAt: local(28, 10, 0, 0, 8), startsAt: local(2, 10), attendance: "attended", attendanceAt: local(2, 12) })]));
    expect(d.schedule.cohort.total.total.value).toBe(0);
    expect(d.schedule.fromEarlierMonths.attended.value).toBe(1);
    expect(d.schedule.attendanceRatePercent.status).toBe("unavailable");
  });
  it("data passada sem status é não verificada, fora da taxa e nunca falta", () => {
    const d = data(small(conversations, [evaluation("x", "a"), evaluation("y", "a", { attendance: "attended", attendanceAt: local(20, 12) })]));
    expect(d.schedule.cohort.unverified.total).toMatchObject({ value: 1, status: "unverified" });
    expect(d.schedule.cohort.no_show.total.value).toBe(0);
    expect(d.schedule.attendanceRatePercent.value).toBe(100);
  });
  it("com espelho no Clinicorp, só status mapeado comprova presença ou falta", () => {
    const config = v2Config(), now = local(1, 9, 0, 0, 10);
    const linked = evaluation("x", "a", { clinicorpAppointmentId: "1" });
    expect(cohortStatusOf(linked, "ATTENDED", config, now)).toBe("attended");
    expect(cohortStatusOf(linked, "MISSED", config, now)).toBe("no_show");
    expect(cohortStatusOf(linked, "CONFIRMED", config, now)).toBe("unverified");
    expect(cohortStatusOf(linked, null, config, now)).toBe("unverified");
    // Sem resposta de lá, vale a marcação feita na /agenda.
    expect(cohortStatusOf({ ...linked, attendance: "no_show", attendanceAt: local(20, 12) }, null, config, now)).toBe("no_show");
  });
  it("cancelada e marcação manual ficam fora da coorte", () => {
    const d = data(small(conversations, [evaluation("x", "a", { status: "canceled" }), evaluation("y", "a", { source: "manual" })]));
    expect(d.schedule.cohort.total.total.value).toBe(0);
  });
  it("agendou sem qualificar marca a qualificação como parcial", () => {
    const d = data(small(conversations, [evaluation("x", "a")]));
    expect(d.schedule.qualified.total).toMatchObject({ value: 0, status: "partial" });
  });
});

describe("relatório mensal v2 - comparativo", () => {
  it("empresta do mês anterior só os números comparáveis", () => {
    expect(monthlyComparison(data())).toEqual({ contacts: 214, scheduled: 31, agentFirstResponseSeconds: 38, unanswered: 14, noShowRatePercent: 22 });
  });
  it("o motor não inventa comparativo: nasce nulo", () => expect(data().comparison).toBeNull());
  it("mediana", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});
