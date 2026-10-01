import { describe, expect, it } from "vitest";
import { contactActivity, periodContactActivity } from "@/modules/reports/contact-activity";
import { evaluateMonthlyMetrics } from "@/modules/reports/monthly";
import { v2Input, local } from "./fixtures/monthly-report-v2";

const m = (conversationId: string, role: string, sentBy: string | null, day: number, second = 0) =>
  ({ conversationId, role, sentBy, createdAt: local(day, 10, 0, second) });

describe("mesma população de atendimento no operacional e no mensal", () => {
  it("conta resposta, nunca duas mensagens recebidas como resposta", () => {
    const activity = periodContactActivity([m("a", "user", null, 1), m("a", "user", null, 2),
      m("b", "user", null, 1), m("b", "assistant", "human", 1, 30)]);
    expect(activity.active.size).toBe(2);
    expect(activity.attended.size).toBe(1);
    expect(activity.responseRate).toBe(0.5);
  });
  it("ignora disparos antes da chegada e respostas sem autoria", () => {
    expect(contactActivity([m("a", "assistant", "agent", 1), m("a", "user", null, 2),
      m("a", "assistant", null, 3)]).replies).toHaveLength(0);
    expect(periodContactActivity([m("a", "assistant", "agent", 1)]).active.size).toBe(0);
  });
  it("deduplica o contato e separa conjuntos de IA e humano sem subtrair pessoas distintas", () => {
    const a = periodContactActivity([m("a", "user", null, 1), m("a", "assistant", "agent", 1, 30),
      m("a", "assistant", "agent", 2), m("b", "user", null, 1), m("b", "assistant", "human", 1, 30),
      m("c", "user", null, 1), m("c", "assistant", "agent", 1, 30), m("c", "assistant", "human", 3)]);
    expect([...a.aiOnly]).toEqual(["a"]);
    expect([...a.human]).toEqual(["b", "c"]);
    expect(a.attended.size).toBe(3);
  });
  it("confere o total mensal contra o operacional com a mesma janela e agentes", () => {
    const input = v2Input();
    // Contato antigo, resposta só humana, mensagens proativas e contato sem resposta.
    const old = { ...input.conversations[0], id: "old", leadId: "old", lead: { createdAt: local(1, 10, 0, 0, 8) },
      messages: [{ id: "old-u", ...m("old", "user", null, 1) }, { id: "old-h", ...m("old", "assistant", "human", 1, 20) }] };
    input.conversations.push(old, { ...old, id: "unanswered", messages: [{ id: "u-u", ...m("unanswered", "user", null, 2) }] },
      { ...old, id: "proactive", messages: [{ id: "p-a", ...m("proactive", "assistant", "agent", 2) }] });
    const operational = periodContactActivity(input.conversations.flatMap((c) => c.messages.filter((m) => m.createdAt >= input.start && m.createdAt < input.end)
      .map((m) => ({ ...m, conversationId: c.id }))), input.events.filter((e) => e.kind === "handoff" && e.createdAt >= input.start && e.createdAt < input.end).map((e) => e.conversationId));
    const monthly = evaluateMonthlyMetrics(input).data;
    expect(operational.attended.size).toBe(monthly.service.contacts.total.value);
    expect(operational.attended.size).toBe(215);
    expect(operational.aiOnly.size).toBe(monthly.service.aiOnly.value);
    expect(operational.transferred.size).toBe(monthly.service.transferred.value);
    expect(operational.active.size).toBe(216);
  });
});
