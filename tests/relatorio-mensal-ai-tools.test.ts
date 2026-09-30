import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  db: { conversation: { findFirst: vi.fn() } },
  features: vi.fn(), channels: vi.fn(), chain: vi.fn(), secret: vi.fn(), provider: vi.fn(), usage: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.db }));
vi.mock("@/modules/scheduling/features", () => ({ getCalendarFeatures: mocks.features }));
vi.mock("@/modules/whatsapp/instances", () => ({ listWhatsappChannels: mocks.channels }));
vi.mock("@/modules/ai", async () => {
  const types = await import("@/modules/ai/types");
  return { ...types, getUsableChain: mocks.chain, resolveSecret: mocks.secret, createProvider: mocks.provider };
});
vi.mock("@/modules/ai/usage", () => ({ recordUsage: mocks.usage }));
import { evaluateMonthlyMetrics, type MonthlyReport } from "@/modules/reports/monthly";
import { createMonthlyAiToolbox, MONTHLY_AI_TOOLS } from "@/modules/reports/monthly-ai-tools";
import { answerMonthlyAi } from "@/modules/reports/monthly-ai-service";
import type { MonthlyAiDraft } from "@/modules/reports/monthly-ai";
import { roiAppointment, roiFixture, roiInput } from "./fixtures/monthly-roi";

/** Dez agendamentos: dois com tipo e oito sem; um dos oito sem conversa (sem horário de chegada). */
function report(): MonthlyReport {
  const input = roiInput();
  input.config = { ...input.config, countUntypedAsEvaluations: true };
  input.appointments = [
    roiAppointment("typed-1"), roiAppointment("typed-2"),
    ...Array.from({ length: 7 }, (_, i) => ({ ...roiAppointment(`untyped-${i}`), serviceType: null })),
    { ...roiAppointment("untyped-orphan", "missing"), serviceType: null, leadId: null, conversationId: null },
  ];
  const { metrics, evidence } = evaluateMonthlyMetrics(input);
  return { ...roiFixture(), assumptions: input.config, current: metrics, evidence };
}
const agents = [{ id: "a", name: "Agente A", isPrimary: true, archived: false, actions: [{ key: "schedule_meeting", enabled: true, config: { durations: [] } }] }];
const draft = (r: MonthlyReport): MonthlyAiDraft => ({ assumptions: r.assumptions, metricOverrides: { current: {}, previous: {} }, adjustments: "", nextMonth: "", decisionMaker: "", highlights: "", limitationsNote: "", nextActions: [] });

beforeEach(() => { vi.resetAllMocks(); mocks.secret.mockResolvedValue("k"); mocks.usage.mockResolvedValue(undefined); });

describe("ferramentas de leitura do assistente", () => {
  it("lê os registros da mesma passada, com filtros, e anota cada consulta", async () => {
    const toolbox = createMonthlyAiToolbox({ tenantId: "own", report: report(), agents });
    const all = JSON.parse(await toolbox.run("list_appointments", {}));
    const untyped = JSON.parse(await toolbox.run("list_appointments", { untyped: true }));
    const orphan = JSON.parse(await toolbox.run("list_appointments", { untyped: true, bucket: "unclassified" }));
    expect([all.total, untyped.total, orphan.total]).toEqual([10, 8, 1]);
    expect(orphan.rows[0].motivoSemHorario).toBe("sem mensagem do contato antes da marcação");
    expect(toolbox.consulted.map((c) => c.label)).toEqual([
      "10 registros de agendamento", "8 registros de agendamento sem tipo", "1 registro de agendamento sem tipo, sem classificação de horário",
    ]);
    // Nenhum dado de contato nas linhas.
    expect(JSON.stringify(all)).not.toMatch(/nome|telefone|phone|name/i);
  });
  it("recusa ferramenta inexistente e argumento fora do contrato", async () => {
    const toolbox = createMonthlyAiToolbox({ tenantId: "own", report: report(), agents });
    expect(await toolbox.run("delete_appointment", {})).toContain("inexistente");
    expect(await toolbox.run("list_appointments", { tenantId: "other" })).toContain("inválidos");
    expect(toolbox.consulted).toEqual([]);
  });
  it("só abre conversa que está nos registros do relatório, no tenant da action, sem texto das mensagens", async () => {
    const toolbox = createMonthlyAiToolbox({ tenantId: "own", report: report(), agents });
    expect(await toolbox.run("get_conversation", { conversationId: "de-outra-conta" })).toContain("não encontrada");
    expect(mocks.db.conversation.findFirst).not.toHaveBeenCalled();
    mocks.db.conversation.findFirst.mockResolvedValue({ whatsappProvider: "meta", variables: { procedimento: "Implante", nome: "Maria" }, lead: { createdAt: new Date("2026-09-14T10:00:00Z"), status: "new" },
      messages: [{ role: "user", sentBy: null, createdAt: new Date("2026-09-14T10:00:00Z"), audioUrl: null, audioSeconds: null }] });
    const out = await toolbox.run("get_conversation", { conversationId: "outside" });
    const query = mocks.db.conversation.findFirst.mock.calls[0][0];
    expect(query.where).toEqual({ id: "outside", tenantId: "own", isTest: false });
    expect(query.select.messages.select).not.toHaveProperty("content");
    expect(out).toContain("Implante"); expect(out).not.toContain("Maria");
  });
  it("configuração e integrações mostram estado, nunca credencial", async () => {
    mocks.features.mockResolvedValue({ googleEnabled: false, clinicorpEnabled: true });
    mocks.channels.mockResolvedValue([{ provider: "meta", status: "connected", externalId: "secret-phone-id", accessToken: "tok" }]);
    const toolbox = createMonthlyAiToolbox({ tenantId: "own", report: report(), agents });
    const integrations = await toolbox.run("get_integrations", {});
    expect(integrations).toContain("connected"); expect(integrations).not.toMatch(/secret-phone-id|tok"/);
    const config = JSON.parse(await toolbox.run("get_configuration", {}));
    expect(config.agentes[0]).toMatchObject({ nome: "Agente A", agendamento: "ligado", tiposQueOAgenteRegistra: [] });
  });
});

describe("assistente investigando antes de responder", () => {
  it("roda as ferramentas pedidas, devolve as evidências anotadas e só aceita na lista ids que consultou", async () => {
    const r = report();
    const complete = vi.fn()
      .mockResolvedValueOnce({ content: "", toolCalls: [{ id: "c1", name: "list_appointments", arguments: { untyped: true } }] })
      .mockResolvedValueOnce({ content: JSON.stringify({ reply: "Consultei os registros: oito não têm tipo.", changes: [],
        proposal: { kind: "review_list", title: "Agendamentos sem tipo", question: "Deseja gerar a lista para a recepção?", appointmentIds: ["untyped-0", "inventado"] } }), toolCalls: [] });
    mocks.chain.mockResolvedValue([{ model: { provider: "openai", label: "Modelo" }, credentialId: null }]);
    mocks.provider.mockReturnValue({ provider: "openai", isConfigured: () => true, complete });
    const toolbox = createMonthlyAiToolbox({ tenantId: "own", report: r, agents });
    const answer = await answerMonthlyAi([{ role: "user", content: "Por que oito estão sem tipo?" }], draft(r), toolbox);
    expect(complete.mock.calls[0][1]).toBe(MONTHLY_AI_TOOLS);
    expect(complete.mock.calls[1][0].at(-1)).toMatchObject({ role: "tool", toolCallId: "c1" });
    expect(answer.consulted.map((c) => c.label)).toEqual(["8 registros de agendamento sem tipo"]);
    expect(answer.review?.rows.map((row) => row.appointmentId)).toEqual(["untyped-0"]);
    expect(answer.review?.rows[0].issues[0]).toContain("sem tipo");
  });
  it("sem ferramentas, responde como antes e sem evidências", async () => {
    const complete = vi.fn().mockResolvedValue({ content: JSON.stringify({ reply: "Ok", changes: [] }), toolCalls: [] });
    mocks.chain.mockResolvedValue([{ model: { provider: "openai", label: "Modelo" }, credentialId: null }]);
    mocks.provider.mockReturnValue({ provider: "openai", isConfigured: () => true, complete });
    const answer = await answerMonthlyAi([{ role: "user", content: "Oi" }], draft(report()));
    expect(complete.mock.calls[0][1]).toEqual([]); expect(answer.consulted).toEqual([]); expect(answer.review).toBeUndefined();
  });
});
