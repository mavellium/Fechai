import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/modules/scheduling/clinicorp", () => ({ readClinicorpReport: vi.fn() }));
import { monthlyAccountPrice, monthlyAgentSource, monthlyInitialMonth, monthlyScheduleSuggestion } from "@/modules/reports/monthly-import";
import { monthlyAssumptionsSchema } from "@/modules/reports/monthly-config";
import { calculateMonthlyMetrics } from "@/modules/reports/monthly";
import { roiAppointment, roiConfig, roiConversation, roiInput } from "./fixtures/monthly-roi";

const week = [[], [{ start: 840, end: 1080 }], [{ start: 540, end: 720 }, { start: 840, end: 1080 }], [], [], [], [{ start: 540, end: 705 }]];
const source = (id = "a", config: unknown = { timezone: "America/Sao_Paulo", weeklyAvailability: week }) => monthlyAgentSource({
  id, name: `Agente ${id}`, isPrimary: id === "a", archived: false, actions: [{ key: "schedule_meeting", config }],
});

describe("importação do tenant e dos agentes para ROI", () => {
  it("usa preço Starter e preserva preço negociado, inclusive cortesia", () => {
    expect(monthlyAccountPrice({ planKey: "STARTER", priceCentsOverride: null }).priceCents).toBe(19900);
    expect(monthlyAccountPrice({ planKey: "STARTER", priceCentsOverride: 12345 }).priceCents).toBe(12345);
    expect(monthlyAccountPrice({ planKey: "STARTER", priceCentsOverride: 0 }).priceCents).toBe(0);
  });
  it("não abre agosto por padrão para uma conta criada em setembro", () => {
    const created = new Date("2026-09-09T13:00:00Z"), now = new Date("2026-09-28T12:00:00Z");
    expect(monthlyInitialMonth(created, undefined, undefined, now)).toBe("2026-09");
    expect(monthlyInitialMonth(created, "2026-08", undefined, now)).toBe("2026-09");
    expect(monthlyInitialMonth(new Date("2026-07-01T03:00:00Z"), "2026-08", undefined, now)).toBe("2026-08");
    expect(monthlyInitialMonth(new Date("2026-07-01T03:00:00Z"), undefined, "2026-09", now)).toBe("2026-09");
  });
  it("preserva a grade por dia, pausas e minutos sem usar horário padrão", () => {
    expect(source().schedule?.hours).toEqual(week);
    expect(source("empty", null).schedule).toBeNull();
    expect(source("default", {}).schedule).toBeNull();
    expect(source("invalid", { timezone: "America/Sao_Paulo", weeklyAvailability: [[{ start: 800, end: 700 }]] }).schedule).toBeNull();
    const old = source("legacy", { timezone: "America/Sao_Paulo", workdays: [1], startTime: "09:00", endTime: "18:00", breaks: [{ startTime: "12:00", endTime: "13:00" }] });
    expect(old.schedule?.hours[1]).toEqual([{ start: 540, end: 720 }, { start: 780, end: 1080 }]);
  });
  it("combina somente as grades selecionadas e não duplica intervalos", () => {
    const b = source("b", { timezone: "America/Sao_Paulo", weeklyAvailability: [[], [{ start: 720, end: 900 }], [], [], [], [], []] });
    expect(monthlyScheduleSuggestion([source(), b], ["a"]).hours).toEqual(week);
    expect(monthlyScheduleSuggestion([source(), b], ["a", "b"]).hours?.[1]).toEqual([{ start: 720, end: 1080 }]);
    expect(monthlyScheduleSuggestion([source(), b], []).hours?.[1]).toEqual([{ start: 720, end: 1080 }]);
  });
  it("recusa união de fusos diferentes e avisa quando falta grade", () => {
    const b = source("b", { timezone: "America/Manaus", weeklyAvailability: week });
    expect(monthlyScheduleSuggestion([source(), b], []).hours).toBeNull();
    expect(monthlyScheduleSuggestion([source(), source("missing", null)], []).warning).toBeTruthy();
  });
  it("seleção de um ou mais agentes filtra contatos, agendamentos, eventos e picos", () => {
    const input = roiInput();
    input.conversations = [{ ...roiConversation("ca"), agentId: "a" }, { ...roiConversation("cb"), agentId: "b" }];
    input.appointments = [{ ...roiAppointment("aa", "ca"), agentId: "a" }, { ...roiAppointment("ab", "cb"), agentId: "b" }];
    input.events = [{ conversationId: "ca", kind: "handoff", procedure: "Implante", createdAt: input.conversations[0].messages[0].createdAt }, { conversationId: "cb", kind: "handoff", procedure: "Implante", createdAt: input.conversations[1].messages[0].createdAt }];
    input.config.agentIds = ["a"];
    const one = calculateMonthlyMetrics(input);
    expect(one.newContacts).toBe(1); expect(one.handoffs).toBe(1); expect(one.attended.outside).toBe(1);
    expect(one.peaks.reduce((n, p) => n + p.messages, 0)).toBe(1);
    input.config.agentIds = ["a", "b"];
    const two = calculateMonthlyMetrics(input);
    expect(two.newContacts).toBe(2); expect(two.handoffs).toBe(2); expect(two.attended.outside).toBe(2);
    expect(two.revenueCents).toBe(one.revenueCents! * 2);
  });
  it("seleção de agente não perde a origem de uma consulta de conversa de outro agente", () => {
    const input = roiInput(); input.config.agentIds = ["scheduler"];
    input.conversations[0].agentId = "reception"; input.appointments[0].agentId = "scheduler";
    const result = calculateMonthlyMetrics(input);
    expect(result.newContacts).toBe(0); expect(result.attended.outside).toBe(1); expect(result.revenueCents).toBe(50000);
  });
  it("registros antigos continuam com escopo completo e IDs repetidos são recusados", () => {
    expect(monthlyAssumptionsSchema.safeParse(roiConfig()).success).toBe(true);
    expect(monthlyAssumptionsSchema.safeParse({ ...roiConfig(), agentIds: ["a", "a"] }).success).toBe(false);
  });
});
