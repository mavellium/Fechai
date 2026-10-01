import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/modules/scheduling/clinicorp", () => ({ readClinicorpReport: vi.fn() }));
import { summarizeContactContexts, type ContextContact, type ContextMessage } from "@/modules/reports/contact-context";
import { evaluateMonthlyMetrics, type MonthlyConversation, type MonthlyAppointment } from "@/modules/reports/monthly";
import { validateMonthlyReport } from "@/modules/reports/monthly-validate";
import { openingSentence } from "@/modules/reports/monthly-format";
import { local, v2Input } from "./fixtures/monthly-report-v2";
const start = new Date("2026-09-01T03:00:00Z"), end = new Date("2026-10-01T03:00:00Z");
const message = (id: string, role: string, sentBy: string | null, day: number, hour = 10): ContextMessage => ({ id, role, sentBy, createdAt: local(day, hour) });
const lead = (id: string, human = false): ContextContact => {
  const messages = [...(human ? [message(`${id}-human`, "assistant", "human", 1, 9)] : []),
    message(`${id}-in`, "user", null, 1), message(`${id}-agent`, "assistant", "agent", 1, 11)];
  return { id, messages, firstMessage: messages[0] };
};
const input = (conversations: ContextContact[], bookings: { id: string; conversationId: string; createdAt: Date }[] = []) => ({ start, end, conversations, bookings });

export function example() {
  const conversations = Array.from({ length: 300 }, (_, n) => lead(`c${n}`, n >= 130));
  const bookings = Array.from({ length: 15 }, (_, n) => ({ id: `a${n}`, conversationId: `c${n}`, createdAt: local(2, 10) }));
  return input(conversations, bookings);
}
describe("iniciativa e conversão usam bases distintas", () => {
  it("300 atendidos não viram 300 novos leads: 15 de 130 = 11,5%", () => {
    const { summary, records } = summarizeContactContexts(example());
    expect(summary.attended).toBe(300);
    expect(summary.groups.find((g) => g.key === "inbound_new")).toMatchObject({ contacts: 130, attended: 130, scheduledContacts: 15, conversionPercent: 11.5 });
    expect(summary.groups.find((g) => g.key === "outbound_human")).toMatchObject({ contacts: 170, scheduledContacts: 0, conversionPercent: 0 });
    expect(summary.groups.reduce((n, g) => n + g.contacts, 0)).toBe(300);
    expect(records).toHaveLength(300);
    expect(summary.acquisition).toBe("not_recorded");
  });
  it("conta pessoas uma vez, mesmo que marquem duas avaliações", () => {
    const data = example(); data.bookings.push({ id: "another", conversationId: "c0", createdAt: local(3, 10) });
    const g = summarizeContactContexts(data).summary.groups.find((g) => g.key === "inbound_new")!;
    expect(g).toMatchObject({ evaluations: 16, scheduledContacts: 15, conversionPercent: 11.5 });
  });
  it("mantém as abordagens sem resposta no denominador da abordagem", () => {
    const c = lead("out", true); c.messages = [c.messages[0]];
    expect(summarizeContactContexts(input([c])).summary.groups.find((g) => g.key === "outbound_human")).toMatchObject({ contacts: 1, attended: 0 });
  });
  it("contato antigo ou importado não vira aquisição nova", () => {
    const old = lead("old"); old.firstMessage = message("old-first", "user", null, 1);
    old.firstMessage.createdAt = new Date("2025-01-01T12:00:00Z");
    const imported = lead("imported"); imported.firstMessage = { ...imported.firstMessage!, contactCreatedAt: new Date("2026-08-01T12:00:00Z") };
    const g = summarizeContactContexts(input([old, imported])).summary.groups;
    expect(g.find((g) => g.key === "inbound_existing")?.contacts).toBe(2);
    expect(g.find((g) => g.key === "inbound_new")?.contacts).toBe(0);
  });
  it("sem histórico suficiente, mantém contexto e taxa não identificados", () => {
    const c = lead("legacy"); delete c.firstMessage;
    const g = summarizeContactContexts(input([c])).summary.groups.find((g) => g.key === "unknown")!;
    expect(g).toMatchObject({ contacts: 1, conversionPercent: null });
  });
  it("lembrete, campanha e follow-up dependem da operação registrada, não da autoria humana ou do texto", () => {
    const cs = [lead("reminder", true), lead("campaign", true), lead("followup", true)];
    const events = cs.map((c, i) => ({ conversationId: c.id, kind: ["contact_reminder", "contact_campaign", "contact_followup"][i],
      messageId: c.messages[0].id, createdAt: c.messages[0].createdAt }));
    const groups = summarizeContactContexts({ ...input(cs), events }).summary.groups;
    for (const key of ["outbound_reminder", "outbound_campaign", "outbound_followup"]) expect(groups.find((g) => g.key === key)?.contacts).toBe(1);
    const wrong = { ...events[0], conversationId: "another" };
    expect(summarizeContactContexts({ ...input([cs[0]]), events: [wrong] }).summary.groups.find((g) => g.key === "outbound_human")?.contacts).toBe(1);
  });
  it("uma resposta na virada do mês não vira uma nova abordagem", () => {
    const c = lead("continuing", true);
    c.firstMessage = { ...c.firstMessage!, beforeWindow: { role: "user", sentBy: null, createdAt: new Date("2026-09-01T02:00:00Z") } };
    expect(summarizeContactContexts(input([c])).summary.groups.find((g) => g.key === "continued")?.contacts).toBe(1);
    const event = { conversationId: c.id, kind: "contact_reminder", messageId: c.messages[0].id, createdAt: c.messages[0].createdAt };
    expect(summarizeContactContexts({ ...input([c]), events: [event] }).summary.groups.find((g) => g.key === "outbound_reminder")?.contacts).toBe(1);
  });
  it("agenda sem contato na base, anterior à entrada ou fora do mês não infla conversão", () => {
    const result = summarizeContactContexts(input([lead("one")], [
      { id: "prior", conversationId: "one", createdAt: local(1, 8) },
      { id: "outside", conversationId: "one", createdAt: end },
      { id: "other", conversationId: "missing", createdAt: local(2, 10) },
    ]));
    expect(result.summary.unattributedEvaluations).toBe(2);
    expect(result.summary.attributedEvaluations).toBe(0);
    expect(result.records[0].booked).toBe(false);
  });
});

describe("mensal: contexto congelado nos dados e nas evidências", () => {
  function monthlyExample() {
    const data = example(), base = v2Input();
    const conversations: MonthlyConversation[] = data.conversations.map((c) => ({ ...c, agentId: "agent", leadId: c.id,
      lead: { createdAt: start }, firstInbound: c.messages.find((m) => m.role === "user")!.createdAt, variables: {},
      messages: c.messages.map((m) => ({ ...m, id: m.id! })) }));
    const appointments: MonthlyAppointment[] = data.bookings.map((a) => ({ ...a, agentId: "agent", leadId: a.conversationId,
      source: "agent", kind: "evaluation", status: "scheduled", startsAt: local(20, 10), serviceType: "Avaliação", clinicorpAppointmentId: null }));
    return evaluateMonthlyMetrics({ ...base, conversations, appointments, events: [] });
  }
  it("alinha o mensal ao classificador do operacional e apresenta 15 de 130 no resumo", () => {
    const { data, evidence } = monthlyExample();
    expect(data.service.contacts.total.value).toBe(300);
    expect(data.service.contexts).toEqual(summarizeContactContexts(example()).summary);
    expect(evidence.contexts?.filter((r) => r.context === "inbound_new")).toHaveLength(130);
    expect(openingSentence("setembro", data)).toContain("130 novos contatos iniciaram a conversa. 15 desses contatos agendaram uma avaliação (11,5%)");
    expect(data.leads.suggestions).toEqual([]);
  });
  it("recusa taxa ou soma de contexto manipulada antes do fechamento", () => {
    const { data } = monthlyExample();
    const texts = { decisionMaker: "Dono", operationalContact: "Recepção" };
    expect(validateMonthlyReport(data, texts).filter((i) => i.key === "contexts_sum")).toEqual([]);
    expect(validateMonthlyReport(data, { ...texts, highlights: "130 leads do tráfego pago" })).toContainEqual(expect.objectContaining({ key: "acquisition_claim" }));
    expect(validateMonthlyReport(data, { ...texts, highlights: "Conversão de 5%" })).toContainEqual(expect.objectContaining({ key: "conversion_claim" }));
    expect(validateMonthlyReport(data, { ...texts, highlights: "Conversão de 11,5% entre as novas entradas" }).filter((i) => i.key === "conversion_claim")).toEqual([]);
    data.service.contexts!.groups.find((g) => g.key === "inbound_new")!.conversionPercent = 5;
    expect(validateMonthlyReport(data, texts)).toContainEqual(expect.objectContaining({ key: "contexts_sum", severity: "blocking" }));
  });
});
