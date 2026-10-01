import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({
  tenant: { updateMany: vi.fn() },
  whatsappIncident: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/modules/scheduling/clinicorp", () => ({ readClinicorpReport: vi.fn() }));
import { evaluateMonthlyMetrics, type MonthlyConversation } from "@/modules/reports/monthly";
import { arrivalSlot, availabilityMetrics } from "@/modules/reports/monthly-operations";
import { caseFactItems, casePeriod, parseCaseFacts } from "@/modules/reports/monthly-case";
import { previousActionsProblem, reviewPreviousActions } from "@/modules/reports/monthly-previous-actions";
import { approvedDocument } from "@/modules/reports/monthly-document";
import { executiveSummary } from "@/modules/reports/monthly-executive";
import { monthlyQuality, showsSeal } from "@/modules/reports/monthly-quality";
import { monthlyLimitations } from "@/modules/reports/monthly-limitations";
import { applyMonthlyOverrides } from "@/modules/reports/monthly-overrides";
import { exactDateIn, timeBreakdown, type MonthlyTimeMetrics } from "@/modules/reports/monthly-time";
import { summarizeLeadQuality, type LeadRow } from "@/modules/lead-insights/summary";
import { trackWhatsappIncident } from "@/modules/whatsapp/incidents";
import type { WhatsappHealth } from "@/modules/whatsapp/health";
import { roiAppointment, roiConfig, roiFixture, roiInput } from "./fixtures/monthly-roi";

const at = (iso: string) => new Date(iso);
/** Conversa respondida pelo agente; `extra` são as mensagens seguintes. */
const conversation = (id: string, arrival: string, extra: MonthlyConversation["messages"] = []): MonthlyConversation => ({
  id, leadId: id, variables: {}, lead: { createdAt: at(arrival) }, firstInbound: at(arrival),
  messages: [{ id: `${id}-in`, role: "user", sentBy: null, createdAt: at(arrival) },
    { id: `${id}-out`, role: "assistant", sentBy: "agent", createdAt: new Date(at(arrival).getTime() + 10_000) }, ...extra],
});
const human = (id: string, when: string) => ({ id, role: "assistant", sentBy: "human", createdAt: at(when) });

describe("recepção: o que aconteceu com as conversas passadas para a equipe", () => {
  // Expediente da amostra: seg a sex, 09:00–18:00 de Brasília (12:00–21:00 UTC).
  const input = () => {
    const base = roiInput();
    base.conversations = [
      conversation("so-agente", "2026-09-14T13:00:00Z"),
      conversation("respondida", "2026-09-14T14:00:00Z", [human("r1", "2026-09-14T14:25:00Z")]),
      conversation("demorou", "2026-09-15T14:00:00Z", [human("r2", "2026-09-15T17:30:00Z")]),
      conversation("sem-resposta", "2026-09-29T14:00:00Z"),
      conversation("equipe-entrou", "2026-09-16T14:00:00Z", [human("r3", "2026-09-16T14:10:00Z")]),
    ];
    base.appointments = [];
    base.events = [
      { conversationId: "respondida", kind: "handoff", procedure: "", createdAt: at("2026-09-14T14:05:00Z") },
      // Segunda transferência da mesma conversa: a espera conta da primeira.
      { conversationId: "respondida", kind: "handoff", procedure: "", createdAt: at("2026-09-14T14:20:00Z") },
      { conversationId: "demorou", kind: "handoff", procedure: "", createdAt: at("2026-09-15T14:05:00Z") },
      { conversationId: "sem-resposta", kind: "handoff", procedure: "", createdAt: at("2026-09-29T14:05:00Z") },
    ];
    return base;
  };
  it("só o agente + passadas para a recepção + equipe na conversa somam os contatos atendidos", () => {
    const { metrics } = evaluateMonthlyMetrics(input());
    const r = metrics.reception!;
    expect(r).toMatchObject({ agentOnly: 1, transferred: 3, teamJoined: 1 });
    expect(r.agentOnly + r.transferred + r.teamJoined).toBe(metrics.conversations.inside + metrics.conversations.outside + metrics.conversations.unclassified);
  });
  it("respondidas x de y, mediana da 1ª resposta humana, espera acima de 1 hora e sem resposta no fim do mês", () => {
    const { metrics, evidence } = evaluateMonthlyMetrics(input());
    // Esperas: 20 min e 3h25; a sem resposta espera até o fim do mês.
    expect(metrics.reception).toMatchObject({ answered: 2, unanswered: 1, overHour: 2 });
    expect(metrics.reception!.medianSeconds).toBe((20 * 60 + (3 * 60 + 25) * 60) / 2);
    const row = evidence.conversations.find((c) => c.conversationId === "sem-resposta")!;
    expect(row.handoffAt).toBe("2026-09-29T14:05:00.000Z"); expect(row.teamReplyAt).toBeNull();
    const table = executiveSummary({ ...roiFixture(), current: metrics }).tables.reception!;
    expect(table.rows.map((r) => r.cells[1])).toEqual(["2 de 3", "1h53", "2", "1"]);
  });
  it("resposta que só veio no mês seguinte não conta: o relatório é do que aconteceu até o fim do mês", () => {
    const base = input();
    base.conversations[3] = conversation("sem-resposta", "2026-09-29T14:00:00Z", [human("r4", "2026-10-01T13:00:00Z")]);
    expect(evaluateMonthlyMetrics(base).metrics.reception).toMatchObject({ answered: 2, unanswered: 1 });
  });
  it("correção manual que quebra a soma derruba o selo e a frase volta ao formato antigo", () => {
    const r = roiFixture();
    r.current = applyMonthlyOverrides(evaluateMonthlyMetrics(input()).metrics, { conversations: { inside: 9 } }, r.assumptions);
    expect(monthlyQuality(r).reception?.status).toBe("inconsistent");
    expect(executiveSummary(r).attendance[1]).toContain("só com a IA");
  });
});

describe("horário: pelo expediente cadastrado pela clínica, não por faixa fixa", () => {
  const config = roiConfig();
  it("o mesmo horário é expediente numa clínica e fora em outra", () => {
    // Terça, 19:30 de Brasília.
    const evening = at("2026-09-15T22:30:00Z");
    expect(arrivalSlot(evening, config)).toBe("afterClose");
    const late = { ...config, humanHours: config.humanHours!.map((day) => day.map(() => ({ start: 540, end: 1260 }))) };
    expect(arrivalSlot(evening, late)).toBe("inside");
  });
  it("antes de abrir, no intervalo, depois de fechar e dia sem expediente", () => {
    const lunch = { ...config, humanHours: config.humanHours!.map((day) => day.length ? [{ start: 480, end: 720 }, { start: 840, end: 1080 }] : []) };
    expect(arrivalSlot(at("2026-09-15T10:00:00Z"), lunch)).toBe("beforeOpen");   // 07:00
    expect(arrivalSlot(at("2026-09-15T16:00:00Z"), lunch)).toBe("onBreak");      // 13:00
    expect(arrivalSlot(at("2026-09-15T18:00:00Z"), lunch)).toBe("inside");       // 15:00
    expect(arrivalSlot(at("2026-09-15T22:00:00Z"), lunch)).toBe("afterClose");   // 19:00
    expect(arrivalSlot(at("2026-09-13T15:00:00Z"), lunch)).toBe("closedDay");    // domingo
    expect(arrivalSlot(at("2026-09-15T16:00:00Z"), { ...config, humanHours: null })).toBe("unclassified");
  });
  it("as chegadas do mês somam os contatos atendidos", () => {
    const { metrics } = evaluateMonthlyMetrics(roiInput());
    const a = metrics.arrivals!;
    expect(a.inside + a.beforeOpen + a.onBreak + a.afterClose + a.closedDay + a.unclassified).toBe(1);
    // 14/09 às 07:00 de Brasília: antes de abrir.
    expect(a.beforeOpen).toBe(1);
  });
});

describe("disponibilidade do agente", () => {
  const month = { start: at("2026-09-01T03:00:00Z"), end: at("2026-10-01T03:00:00Z"), now: at("2026-10-05T12:00:00Z") };
  it("sem medição no mês é não medido, jamais 100% presumido", () => {
    expect(availabilityMetrics({ ...month, trackedSince: null, incidents: [], inbound: [] })).toBeNull();
    expect(availabilityMetrics({ ...month, trackedSince: at("2026-10-02T00:00:00Z"), incidents: [], inbound: [] })).toBeNull();
    const r = roiFixture(); r.current = { ...r.current, availability: null };
    expect(monthlyQuality(r).availability?.status).toBe("pending");
    expect(monthlyLimitations(r).map((l) => l.key)).toContain("uptime");
    expect(executiveSummary(r).attendance.join(" ")).not.toMatch(/no ar/);
  });
  it("% do mês no ar, incidentes e contatos afetados; quedas sobrepostas contam uma vez", () => {
    const result = availabilityMetrics({ ...month, trackedSince: at("2026-08-01T00:00:00Z"),
      incidents: [
        { provider: "evolution", startedAt: at("2026-09-17T22:00:00Z"), endedAt: at("2026-09-18T01:00:00Z") },
        { provider: "meta", startedAt: at("2026-09-17T23:00:00Z"), endedAt: at("2026-09-18T00:00:00Z") },
      ],
      inbound: [
        { conversationId: "a", at: at("2026-09-17T23:30:00Z") }, { conversationId: "a", at: at("2026-09-17T23:40:00Z") },
        // Chegou 5 min depois da volta: é o que o WhatsApp reteve durante a queda.
        { conversationId: "b", at: at("2026-09-18T01:05:00Z") },
        { conversationId: "c", at: at("2026-09-18T03:00:00Z") },
      ] })!;
    expect(result.incidents).toEqual([{ startedAt: "2026-09-17T22:00:00.000Z", endedAt: "2026-09-18T01:00:00.000Z", seconds: 10_800, contacts: 2 }]);
    expect(result).toMatchObject({ downSeconds: 10_800, coveredSeconds: 30 * 86_400, contactsAffected: 2, partial: false, percent: 99.5 });
  });
  it("medição que começou no meio do mês vale só para o período medido, e isso é dito", () => {
    const result = availabilityMetrics({ ...month, trackedSince: at("2026-09-16T03:00:00Z"), incidents: [{ provider: "evolution", startedAt: at("2026-09-10T00:00:00Z"), endedAt: null }], inbound: [] })!;
    // Queda aberta desde antes: conta do início da medição até o fim do mês.
    expect(result).toMatchObject({ partial: true, percent: 0, coveredSeconds: 15 * 86_400 });
    expect(result.incidents[0].endedAt).toBeNull();
    const r = roiFixture(); r.current = { ...r.current, availability: result };
    expect(monthlyQuality(r).availability?.status).toBe("partial");
    expect(monthlyLimitations(r).find((l) => l.key === "uptime")?.text).toContain("16/09");
    expect(executiveSummary(r).attendance.join(" ")).toContain("do período medido");
  });
  it("queda nunca arredonda para 100%", () => {
    const result = availabilityMetrics({ ...month, trackedSince: at("2026-08-01T00:00:00Z"), incidents: [{ provider: "evolution", startedAt: at("2026-09-17T22:00:00Z"), endedAt: at("2026-09-17T22:01:00Z") }], inbound: [] })!;
    expect(result.percent).toBe(99.9);
  });
});

describe("registro de quedas pelo monitor de saúde", () => {
  const health = (patch: Partial<WhatsappHealth>): WhatsappHealth => ({ tenantId: "t", provider: "evolution", storedStatus: "connected", liveStatus: "connected",
    exists: true, reachable: true, lastInboundAt: null, silentHours: null, verdict: "ok", ...patch });
  const now = at("2026-10-02T12:00:00Z");
  beforeEach(() => { vi.resetAllMocks(); db.whatsappIncident.findFirst.mockResolvedValue(null); });
  it("a primeira varredura marca desde quando a conta é medida", async () => {
    await trackWhatsappIncident(health({}), now);
    expect(db.tenant.updateMany).toHaveBeenCalledWith({ where: { id: "t", uptimeTrackedSince: null }, data: { uptimeTrackedSince: now } });
    expect(db.whatsappIncident.create).not.toHaveBeenCalled();
  });
  it("queda confirmada pelo provedor abre um incidente, uma vez só; a volta fecha", async () => {
    await trackWhatsappIncident(health({ liveStatus: "disconnected", verdict: "desconectado" }), now);
    expect(db.whatsappIncident.create).toHaveBeenCalledWith({ data: { tenantId: "t", provider: "evolution", kind: "desconectado", startedAt: now } });
    // Ciclo seguinte: o monitor já sincronizou o status; o incidente aberto segue aberto, sem duplicar.
    db.whatsappIncident.create.mockClear();
    await trackWhatsappIncident(health({ storedStatus: "disconnected", liveStatus: "disconnected" }), now);
    expect(db.whatsappIncident.create).not.toHaveBeenCalled(); expect(db.whatsappIncident.updateMany).not.toHaveBeenCalled();
    await trackWhatsappIncident(health({}), now);
    expect(db.whatsappIncident.updateMany).toHaveBeenCalledWith({ where: { tenantId: "t", provider: "evolution", endedAt: null }, data: { endedAt: now } });
  });
  it("suspeita e falha nossa para perguntar não viram incidente; desligado no painel não é queda", async () => {
    await trackWhatsappIncident(health({ verdict: "silencioso" }), now);
    await trackWhatsappIncident(health({ reachable: false, liveStatus: null, verdict: "indeterminado" }), now);
    await trackWhatsappIncident(health({ storedStatus: "disconnected", liveStatus: "disconnected" }), now);
    expect(db.whatsappIncident.create).not.toHaveBeenCalled();
  });
  it("nunca lança: registro com o banco fora do ar não derruba o monitor", async () => {
    db.tenant.updateMany.mockRejectedValue(new Error("DB off")); vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(trackWhatsappIncident(health({ liveStatus: "disconnected" }), now)).resolves.toBeUndefined();
  });
});

describe("agenda: falta, sem confirmação e consulta que ainda vai acontecer", () => {
  it("falta marcada conta como falta; sem marcação é sem confirmação, nunca falta; marcada para depois aguarda", () => {
    const input = roiInput();
    const appointment = (id: string, patch: Partial<ReturnType<typeof roiAppointment>>) => ({ ...roiAppointment(id), status: "scheduled", ...patch });
    input.appointments = [
      appointment("compareceu", { attendance: "attended", attendanceAt: at("2026-09-15T16:00:00Z") }),
      appointment("faltou", { attendance: "no_show", attendanceAt: at("2026-09-15T16:00:00Z") }),
      appointment("sem-marcacao", {}),
      appointment("outubro", { startsAt: at("2026-10-08T15:00:00Z") }),
    ];
    const { metrics } = evaluateMonthlyMetrics(input);
    expect(metrics.attended.outside).toBe(1);
    expect(metrics.agenda).toEqual({ noShow: { inside: 0, outside: 1, unclassified: 0 }, unconfirmed: { inside: 0, outside: 1, unclassified: 0 }, upcoming: { inside: 0, outside: 1, unclassified: 0 } });
    expect(metrics.procedures[0]).toMatchObject({ name: "Implante", scheduled: 4, attended: 1, attendedOutside: 1 });
  });
});

describe("tempo devolvido detalhado e selo de estimativa", () => {
  const time: MonthlyTimeMetrics = { textMessages: 1180, audios: 37, audioMinutes: 125, unmeasuredAudios: 0, longAudios: 14, longestAudioSeconds: 372,
    sessions: { all: { count: 0, averageMinutes: null, medianMinutes: null, averageMessages: null }, scheduled: { count: 0, averageMinutes: null, medianMinutes: null, averageMessages: null },
      handoff: { count: 0, averageMinutes: null, medianMinutes: null, averageMessages: null }, lost: { count: 0, averageMinutes: null, medianMinutes: null, averageMessages: null },
      other: { count: 0, averageMinutes: null, medianMinutes: null, averageMessages: null } }, toSchedule: { count: 0, averageMinutes: null, medianMinutes: null, averageMessages: null } };
  const withTime = (secondsPerMessage: number | null) => {
    const r = roiFixture(); r.assumptions = { ...r.assumptions, secondsPerMessage, minutesPerConversation: null };
    r.automatic = { ...r.automatic!, current: { ...r.automatic!.current, time } };
    r.current = applyMonthlyOverrides(r.automatic.current, {}, r.assumptions);
    return r;
  };
  it("quantidade de áudios, total ouvido, maior áudio, acima de 2 min e o tempo de texto; só o que é estimado leva o selo", () => {
    const rows = timeBreakdown(withTime(20));
    expect(rows.map((row) => [row.label, row.value, Boolean(row.estimate)])).toEqual([
      ["Áudios ouvidos pelo agente (37 áudios)", "2h05", false],
      ["Maior áudio do mês", "6min12s", false],
      ["Áudios acima de 2 minutos", "14", false],
      ["Leitura e resposta de 1.217 mensagens (1.180 de texto e 37 em áudio)", "6h46", true],
      ["Total devolvido à equipe", "8h51", true],
    ]);
  });
  it("sem tempo por mensagem não há linha estimada nem total: nada é estimado no lugar", () => {
    const rows = timeBreakdown(withTime(null));
    expect(rows.some((row) => row.estimate)).toBe(false);
    expect(rows.at(-1)).toEqual({ label: "Mensagens de texto respondidas pelo agente", value: "1.180" });
  });
  it("número medido não leva selo; estimativa e avisos levam", () => {
    const q = monthlyQuality(withTime(20));
    expect(showsSeal(q.newContacts)).toBe(false); expect(showsSeal(q.audios)).toBe(false);
    expect(showsSeal(q.assumedHours)).toBe(true); expect(q.assumedHours?.status).toBe("estimated");
    expect(showsSeal(undefined)).toBe(false);
  });
});

describe("motivo principal de não agendar", () => {
  const now = at("2026-10-05T12:00:00Z");
  const lead = (patch: Partial<LeadRow> & { loss?: string; idle?: boolean; handoff?: boolean }): LeadRow => ({
    createdAt: at("2026-09-10T12:00:00Z"), status: "new", disqualified: false, disqualifiedReason: null, appointments: [],
    conversation: { needsHuman: Boolean(patch.handoff), lastInboundAt: patch.idle === false ? at("2026-10-05T10:00:00Z") : at("2026-09-10T13:00:00Z"), followUpReason: null, handoffEvents: 0 },
    insight: patch.loss ? { city: null, cityKey: null, firstQuestionKey: null, lossReasonKey: patch.loss } : null, ...patch });
  it("um único motivo por lead, e a soma é exatamente quem não agendou", () => {
    const rows = [
      lead({ appointments: [{ status: "scheduled" }] }), lead({ appointments: [{ status: "scheduled" }], loss: "preco" }),
      lead({ loss: "preco" }), lead({ loss: "preco" }), lead({ loss: "fora_da_regiao" }),
      lead({}), lead({}), lead({}),
      lead({ handoff: true }), lead({ idle: false }), lead({ appointments: [{ status: "canceled" }] }),
    ];
    const q = summarizeLeadQuality(rows, null, now);
    expect(q.notScheduled!.total).toBe(q.leads - q.outcomes.scheduled);
    expect(q.notScheduled!.reasons.reduce((sum, r) => sum + r.count, 0)).toBe(9);
    expect(q.notScheduled!.reasons.map((r) => [r.label, r.count])).toEqual([
      ["Parou de responder", 4], ["Achou caro", 2], ["Ainda em conversa", 1], ["Em atendimento com a equipe", 1], ["Fora da região", 1]]);
    const table = executiveSummary({ ...roiFixture(), leadQuality: q }).tables.reasons!;
    expect(table.rows.at(-1)!.cells).toEqual(["Total (11 leads novos − 2 que agendaram)", "9"]);
  });
  it("com muitos motivos diferentes nada é cortado da soma", () => {
    const keys = ["fora_da_regiao", "preco", "convenio", "horario", "concorrente", "adiou", "sem_interesse", "outro"];
    const q = summarizeLeadQuality([...keys.map((loss) => lead({ loss })), lead({}), lead({ handoff: true })], null, now);
    expect(q.notScheduled!.reasons).toHaveLength(10);
    expect(q.notScheduled!.reasons.reduce((sum, r) => sum + r.count, 0)).toBe(10);
  });
});

describe("caso do mês: idade, áudios, dia da semana e período; nunca a data", () => {
  it("monta os fatos e funciona para quem não agendou", () => {
    expect(caseFactItems({ conversationId: "c", age: 76, audioSeconds: [302, 280], weekday: 6, period: "night", scheduled: false }))
      .toEqual(["76 anos", "sábado à noite", "2 áudios: 5min02s e 4min40s (9min42s no total)", "não agendou"]);
    expect(caseFactItems({ conversationId: "c", age: null, audioSeconds: [130], weekday: 2, period: "morning", scheduled: true }))
      .toEqual(["terça-feira de manhã", "1 áudio de 2min10s", "agendou"]);
    expect([casePeriod(3), casePeriod(9), casePeriod(15), casePeriod(22)]).toEqual(["dawn", "morning", "afternoon", "night"]);
  });
  it("coluna vazia, antiga ou editada à mão não quebra a leitura", () => {
    expect(parseCaseFacts(null)).toBeNull(); expect(parseCaseFacts({ age: 76 })).toBeNull();
    expect(parseCaseFacts({ conversationId: "c", age: 76, audioSeconds: [1], weekday: 9, period: "night", scheduled: false })).toBeNull();
  });
  it("data exata é reconhecida em qualquer formato comum; dia da semana e duração não são data", () => {
    for (const text of ["em 12/09 à noite", "no dia 12, à noite", "em 12 de setembro", "em 1º de março", "12/09/2026"]) expect(exactDateIn(text)).not.toBeNull();
    for (const text of ["num sábado à noite", "2 áudios de quase 5 minutos", "paciente de 76 anos", "quase 10 minutos no total"]) expect(exactDateIn(text)).toBeNull();
  });
});

describe("ações do mês anterior", () => {
  const plan = [{ action: "Lembrete na véspera da consulta", owner: "Mavellium", indicator: "Faltas" }, { action: "Responder em até 30 minutos", owner: "Recepção", indicator: "Espera" }];
  it("a lista é a do plano aprovado; a revisão só acrescenta status e resultado", () => {
    const reviewed = reviewPreviousActions(plan, [{ action: " lembrete na VÉSPERA da consulta ", owner: "", indicator: "", status: "worked", result: "Faltas caíram de 31% para 22%." },
      { action: "Ação que saiu do plano", owner: "", indicator: "", status: "failed", result: "x" }]);
    expect(reviewed).toEqual([
      { action: "Lembrete na véspera da consulta", owner: "Mavellium", indicator: "Faltas", status: "worked", result: "Faltas caíram de 31% para 22%." },
      { action: "Responder em até 30 minutos", owner: "Recepção", indicator: "Espera", status: null, result: "" }]);
    expect(previousActionsProblem(reviewed)).toContain("a ação combinada");
    expect(previousActionsProblem([{ ...reviewed[0] }])).toBeNull();
    expect(previousActionsProblem([{ ...reviewed[0], result: " " }])).not.toBeNull();
    expect(previousActionsProblem([])).toBeNull(); expect(previousActionsProblem(undefined)).toBeNull();
  });
  it("aparecem no topo de “O que ajustamos”, com o status e o número que comprova", () => {
    const r = roiFixture();
    r.previousActions = reviewPreviousActions(plan, [{ action: plan[0].action, owner: "", indicator: "", status: "partial", result: "Mediana de 22 min, 11 acima de 1 hora." }]);
    expect(executiveSummary(r).previousActions[0]).toMatchObject({ status: "partial", result: "Mediana de 22 min, 11 acima de 1 hora." });
  });
});

describe("PDF: só o conteúdo aprovado", () => {
  it("o documento não carrega registros, valores antes da correção, correções nem a conversa do caso", () => {
    const r = roiFixture();
    r.metricOverrides = { current: { newContacts: 4242 }, previous: { qualified: 3131 } };
    r.investmentSource = "ORIGEM-INTERNA"; r.revision = "REVISAO-INTERNA"; r.assumptionsFromMonth = "2026-08";
    r.clinicorpStatusTypes = [{ type: "STATUS-CRU", description: "Status cru do Clinicorp" }] as typeof r.clinicorpStatusTypes;
    r.caseFacts = { conversationId: "CONVERSA-DO-CASO", age: 76, audioSeconds: [302], weekday: 6, period: "night", scheduled: false };
    const json = JSON.stringify(approvedDocument(r));
    for (const internal of ["ORIGEM-INTERNA", "REVISAO-INTERNA", "STATUS-CRU", "CONVERSA-DO-CASO", "4242", "3131", "conversationId\":\"outside", "\"evidence\"", "\"automatic\""]) expect(json).not.toContain(internal);
    const document = approvedDocument(r);
    // O aviso de que houve correção fica; o que foi corrigido, não.
    expect(document.manualAdjustments).toBe(true); expect(document.metricOverrides).toBeUndefined();
    expect(document.caseFacts).toMatchObject({ age: 76, weekday: 6, conversationId: "" });
    expect(document.current).toEqual(r.current); expect(document.adjustments).toBe(r.adjustments);
  });
  it("horas informadas à mão seguem no documento, porque mudam o texto da premissa", () => {
    const r = roiFixture(); r.metricOverrides = { current: { assumedHours: 12, newContacts: 9 }, previous: {} };
    expect(approvedDocument(r).metricOverrides).toEqual({ current: { assumedHours: 12 }, previous: {} });
  });
});
