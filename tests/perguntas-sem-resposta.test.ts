import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fila de perguntas sem resposta (P-87). O que está protegido aqui:
 *
 * - o agente nunca inventa: a regra vai no prompt e a tool manda não responder;
 * - pergunta repetida agrupa (e o mesmo contato não conta duas vezes);
 * - conversa de teste não entra na fila, e registrar nunca derruba o turno;
 * - dado do paciente mascarado para quem não é da clínica (LGPD);
 * - retomar o contato nunca repete envio e respeita janela, bloqueio e "pare";
 * - o tempo médio de resposta do relatório mensal.
 */

const db = vi.hoisted(() => ({
  knowledgeGapSettings: { findUnique: vi.fn(), findMany: vi.fn(), createMany: vi.fn(), updateMany: vi.fn() },
  conversation: { findFirst: vi.fn(), updateMany: vi.fn() },
  knowledgeGap: {
    findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(),
    groupBy: vi.fn(), count: vi.fn(),
  },
  knowledgeGapOccurrence: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
  knowledgeDocument: { findFirst: vi.fn() },
  agent: { findFirst: vi.fn() },
  message: { count: vi.fn() },
  whatsappInstance: { findMany: vi.fn() },
  user: { findMany: vi.fn() },
  $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  $executeRaw: vi.fn(async () => 1),
  $queryRaw: vi.fn(async (): Promise<{ id: string; distance: number }[]> => []),
}));
const embed = vi.hoisted(() => ({ embedQuery: vi.fn(async (): Promise<number[] | null> => null) }));
const events = vi.hoisted(() => ({ recordReportEvent: vi.fn(async () => {}) }));
const handoff = vi.hoisted(() => ({ notifyHandoffGroup: vi.fn(async () => {}) }));
const provider = vi.hoisted(() => ({
  sendMessage: vi.fn(async (): Promise<string | null> => "wa-1"),
  sendGroupMessage: vi.fn(async () => "g-1"),
  isConfigured: vi.fn(() => true),
}));
const blocked = vi.hoisted(() => ({ isPhoneBlocked: vi.fn(async () => false) }));
const convo = vi.hoisted(() => ({ appendMessage: vi.fn(async () => ({ id: "m-1" })) }));
const mail = vi.hoisted(() => ({ sendMail: vi.fn(async () => ({ ok: true as const })) }));
const kb = vi.hoisted(() => ({
  ingestDocument: vi.fn(async () => ({ id: "doc-1", status: "ready" })),
  updateDocument: vi.fn(async () => ({ id: "doc-1", status: "ready" })),
}));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/modules/knowledge-base/embeddings", () => embed);
vi.mock("@/modules/knowledge-base/repository", () => kb);
vi.mock("@/modules/reports/events", () => events);
vi.mock("@/modules/agent-engine/handoff", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/agent-engine/handoff")>()),
  notifyHandoffGroup: handoff.notifyHandoffGroup,
}));
vi.mock("@/modules/whatsapp/meta-config", () => ({ WHATSAPP_PROVIDER_SELECT: {}, getWhatsAppProviderForInstance: () => provider }));
vi.mock("@/modules/whatsapp/blocklist", () => blocked);
vi.mock("@/modules/agent-engine/conversation", () => convo);
vi.mock("@/lib/mail", () => mail);

import { HIDDEN_NAME, HIDDEN_NUMBER, maskName, maskPhone, maskText } from "@/modules/knowledge-gaps/mask";
import { cleanQuestion, formatDuration, formatGapTime, formatGapTimeShort, normalizeQuestion } from "@/modules/knowledge-gaps/text";
import { clinicAnswers, DEFAULT_GAP_SETTINGS, mavelliumAnswers, parseGapSettings } from "@/modules/knowledge-gaps/settings";
import { registerKnowledgeGap } from "@/modules/knowledge-gaps/register";
import { approveGapAnswer, describeResume } from "@/modules/knowledge-gaps/answer";
import { resumeGapContacts } from "@/modules/knowledge-gaps/resume";
import { formatGapNotice, sendGapNotices } from "@/modules/knowledge-gaps/notify";
import { unansweredRule } from "@/modules/agent-engine/unanswered-rule";
import { getToolSchemas, runToolHandler } from "@/modules/agent-engine/tools";
import { calculateMonthlyMetrics } from "@/modules/reports/monthly";
import { roiInput } from "./fixtures/monthly-roi";

const TENANT = "tenant-1";
const CTX = { tenantId: TENANT, conversationId: "conv-1", leadId: "lead-1", agentId: "agent-1" };

function realConversation(content = "vcs aceitam unimed???") {
  return { isTest: false, lead: { isTest: false }, messages: [{ id: "msg-1", content }] };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.knowledgeGapSettings.findUnique.mockResolvedValue(null);
  db.knowledgeGapSettings.findMany.mockResolvedValue([]);
  db.conversation.findFirst.mockResolvedValue(realConversation());
  db.conversation.updateMany.mockResolvedValue({ count: 1 });
  db.knowledgeGap.findFirst.mockResolvedValue(null);
  db.knowledgeGap.create.mockResolvedValue({ id: "gap-new" });
  db.knowledgeGap.update.mockResolvedValue({});
  db.knowledgeGap.updateMany.mockResolvedValue({ count: 1 });
  db.knowledgeGapOccurrence.findUnique.mockResolvedValue(null);
  db.knowledgeGapOccurrence.create.mockResolvedValue({});
  db.knowledgeGapOccurrence.update.mockResolvedValue({});
  db.knowledgeGapOccurrence.updateMany.mockResolvedValue({ count: 1 });
  db.message.count.mockResolvedValue(0);
  db.$queryRaw.mockResolvedValue([]);
  embed.embedQuery.mockResolvedValue(null);
  provider.sendMessage.mockResolvedValue("wa-1");
  provider.isConfigured.mockReturnValue(true);
  blocked.isPhoneBlocked.mockResolvedValue(false);
});

describe("máscara para quem não é da clínica (LGPD)", () => {
  it("nome vira iniciais e telefone guarda só o final", () => {
    expect(maskName("Luciane Aparecida dos Santos")).toBe("L. A. D.");
    expect(maskName(null)).toBe("Contato");
    const phone = maskPhone("5514997631563");
    expect(phone.endsWith("63")).toBe(true);
    expect(phone).not.toContain("99763");
  });

  it("tira nome, telefone e e-mail de dentro do texto da conversa", () => {
    const text = "Oi, sou a Luciane, meu número é (14) 99763-1563 e o e-mail lu.santos@mail.com. Aceita Unimed?";
    const out = maskText(text, { names: ["Luciane Aparecida"], phones: ["5514997631563"] });
    expect(out).not.toMatch(/Luciane|99763|lu\.santos/);
    expect(out).toContain(HIDDEN_NAME);
    expect(out).toContain(HIDDEN_NUMBER);
    expect(out).toContain("Aceita Unimed?");
  });

  it("compara sem acento, palavra inteira, e não come número curto", () => {
    expect(maskText("a julia vem amanhã", { names: ["Júlia"] })).toBe(`a ${HIDDEN_NAME} vem amanhã`);
    expect(maskText("banana e Ana", { names: ["Ana"] })).toBe(`banana e ${HIDDEN_NAME}`);
    expect(maskText("às 14:30, 2 sessões de R$ 350")).toBe("às 14:30, 2 sessões de R$ 350");
  });
});

describe("texto e regra da conta", () => {
  it("agrupa pelo texto sem acento, caixa ou pontuação", () => {
    expect(normalizeQuestion("Vocês aceitam UNIMED???")).toBe(normalizeQuestion("voces aceitam unimed"));
    expect(cleanQuestion("  quanto\n custa  ")).toBe("quanto custa");
    expect(cleanQuestion(42)).toBe("");
  });

  it("formata o tempo de resposta sem transformar ausência em zero", () => {
    expect(formatDuration(90)).toBe("2 min");
    expect(formatDuration(3 * 3600 + 1200)).toBe("3 h 20 min");
    expect(formatDuration(2 * 86_400 + 4 * 3600)).toBe("2 dias e 4 h");
    expect(formatDuration(null)).toBe("—");
    expect(formatGapTime({})).toBe("Sem registro");
    expect(formatGapTime({ gapAnswerSeconds: null, gapsAnswered: 0 })).toBe("Nenhuma aprovada");
    expect(formatGapTime({ gapAnswerSeconds: 7200, gapsAnswered: 3 })).toBe("2 h · 3 aprovadas");
    expect(formatGapTimeShort({ gapAnswerSeconds: 7200 })).toBe(" · 2h");
    expect(formatGapTimeShort({})).toBe("");
  });

  it("sem linha salva usa o padrão; valor estranho cai no padrão; grupo ligado exige grupo", () => {
    expect(parseGapSettings(null)).toEqual(DEFAULT_GAP_SETTINGS);
    const odd = parseGapSettings({ onUnanswered: "sumir", responders: "ninguém", digestHour: 30, timezone: "Marte/Base", notifyWhatsapp: true });
    expect(odd.onUnanswered).toBe("keep");
    expect(odd.responders).toBe("clinic");
    expect(odd.digestHour).toBe(8);
    expect(odd.timezone).toBe("America/Sao_Paulo");
    expect(odd.notifyWhatsapp).toBe(false);
  });

  it("quem responde decide quem pode aprovar", () => {
    expect([clinicAnswers("clinic"), clinicAnswers("mavellium"), clinicAnswers("both")]).toEqual([true, false, true]);
    expect([mavelliumAnswers("clinic"), mavelliumAnswers("mavellium"), mavelliumAnswers("both")]).toEqual([false, true, true]);
  });
});

describe("registro na fila", () => {
  it("pergunta nova cria o assunto com a primeira conversa", async () => {
    const r = await registerKnowledgeGap({ ...CTX, question: "Vocês aceitam o convênio Unimed?" });
    expect(r).toEqual({ status: "created", gapId: "gap-new", mode: "keep" });
    const data = db.knowledgeGap.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ tenantId: TENANT, agentId: "agent-1", question: "Vocês aceitam o convênio Unimed?" });
    expect(data.occurrences.create).toMatchObject({ tenantId: TENANT, conversationId: "conv-1", messageId: "msg-1" });
    expect(db.conversation.findFirst.mock.calls[0][0].where).toEqual({ id: "conv-1", tenantId: TENANT });
  });

  it("sem pergunta do agente, usa a fala do contato em vez de criar item vazio", async () => {
    await registerKnowledgeGap({ ...CTX });
    expect(db.knowledgeGap.create.mock.calls[0][0].data.question).toBe("vcs aceitam unimed???");
  });

  it("guarda o vetor da pergunta para agrupar paráfrases depois", async () => {
    embed.embedQuery.mockResolvedValue([0.1, 0.2]);
    await registerKnowledgeGap({ ...CTX, question: "Aceita Unimed?" });
    expect(db.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("mesma pergunta de outra conversa soma um contato ao assunto aberto", async () => {
    db.knowledgeGap.findFirst.mockResolvedValue({ id: "gap-9" });
    const r = await registerKnowledgeGap({ ...CTX, question: "Aceita UNIMED?" });
    expect(r.status).toBe("grouped");
    expect(db.knowledgeGap.findFirst.mock.calls[0][0].where).toMatchObject({ tenantId: TENANT, agentId: "agent-1", status: "open" });
    expect(db.knowledgeGap.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ askedCount: { increment: 1 } }) }));
    expect(db.knowledgeGap.create).not.toHaveBeenCalled();
  });

  it("o mesmo contato perguntando de novo não conta como outra pessoa", async () => {
    db.knowledgeGap.findFirst.mockResolvedValue({ id: "gap-9" });
    db.knowledgeGapOccurrence.findUnique.mockResolvedValue({ id: "occ-1" });
    const r = await registerKnowledgeGap({ ...CTX, question: "Aceita Unimed?" });
    expect(r.status).toBe("repeated");
    for (const [call] of db.knowledgeGap.update.mock.calls) expect(call.data.askedCount).toBeUndefined();
  });

  it("paráfrase só agrupa quando o vetor está bem perto", async () => {
    embed.embedQuery.mockResolvedValue([0.1, 0.2]);
    db.$queryRaw.mockResolvedValueOnce([{ id: "gap-7", distance: 0.08 }]);
    expect((await registerKnowledgeGap({ ...CTX, question: "Atendem pela Unimed?" })).gapId).toBe("gap-7");

    db.$queryRaw.mockResolvedValueOnce([{ id: "gap-7", distance: 0.3 }]);
    expect((await registerKnowledgeGap({ ...CTX, question: "Quanto custa o clareamento?" })).status).toBe("created");
  });

  it("conversa de teste fica fora da fila", async () => {
    db.conversation.findFirst.mockResolvedValue({ ...realConversation(), isTest: true });
    const r = await registerKnowledgeGap({ ...CTX, question: "Aceita Unimed?" });
    expect(r.status).toBe("test");
    expect(db.knowledgeGap.create).not.toHaveBeenCalled();
  });

  it("falha do banco nunca lança e ainda devolve a regra da conta", async () => {
    db.knowledgeGapSettings.findUnique.mockResolvedValue({ onUnanswered: "handoff" });
    db.conversation.findFirst.mockRejectedValue(new Error("banco fora do ar"));
    await expect(registerKnowledgeGap({ ...CTX, question: "x?" })).resolves.toEqual({ status: "failed", mode: "handoff" });
  });
});

describe("o agente nunca inventa", () => {
  it("a regra vai no prompt; o aviso de base fraca só quando a busca rodou e veio longe", () => {
    expect(unansweredRule(null)).toContain("Nunca invente");
    expect(unansweredRule(null)).toContain("report_unanswered");
    expect(unansweredRule({ text: "", searched: true, closest: null })).toContain("Nenhum trecho");
    expect(unansweredRule({ text: "", searched: true, closest: 0.8 })).toContain("Nenhum trecho");
    expect(unansweredRule({ text: "x", searched: true, closest: 0.3 })).not.toContain("Nenhum trecho");
    expect(unansweredRule({ text: "", searched: false, closest: null })).not.toContain("Nenhum trecho");
  });

  it("report_unanswered exige a pergunta", () => {
    const tool = getToolSchemas([], undefined, []).find((s) => s.name === "report_unanswered");
    expect(tool?.parameters).toMatchObject({ required: ["question"] });
  });

  it("registra, conta no relatório e manda o agente não responder, sem transferir por padrão", async () => {
    const out = await runToolHandler("report_unanswered", { ...CTX }, { question: "Aceita Unimed?" });
    expect(out).toMatch(/Não responda a essa pergunta/);
    expect(out).toMatch(/confirmar com a equipe/);
    expect(events.recordReportEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: "unanswered", tenantId: TENANT }));
    expect(db.knowledgeGap.create).toHaveBeenCalled();
    expect(db.conversation.updateMany).not.toHaveBeenCalled();
  });

  it("com a regra 'passar para a equipe', marca precisa de você e avisa o grupo uma vez", async () => {
    db.knowledgeGapSettings.findUnique.mockResolvedValue({ onUnanswered: "handoff" });
    const out = await runToolHandler("report_unanswered", { ...CTX }, { question: "Aceita Unimed?" });
    expect(db.conversation.updateMany).toHaveBeenCalledWith({
      where: { id: "conv-1", tenantId: TENANT, needsHuman: false },
      data: { needsHuman: true },
    });
    expect(handoff.notifyHandoffGroup).toHaveBeenCalledTimes(1);
    expect(out).toMatch(/passada para a equipe/);
  });

  it("no teste explica que não entrou na fila, mas mantém a regra", async () => {
    db.conversation.findFirst.mockResolvedValue({ ...realConversation(), isTest: true });
    const out = await runToolHandler("report_unanswered", { ...CTX }, { question: "Aceita Unimed?" });
    expect(out).toMatch(/^Conversa de teste/);
    expect(out).toMatch(/Não responda a essa pergunta/);
  });

  it("handoff_human com unanswered também põe a pergunta na fila", async () => {
    await runToolHandler("handoff_human", { ...CTX }, { reason: "quer saber do convênio", unanswered: true, question: "Aceita Bradesco?" });
    expect(db.knowledgeGap.create.mock.calls[0][0].data.question).toBe("Aceita Bradesco?");
  });
});

describe("aprovar ensina o agente", () => {
  beforeEach(() => {
    db.knowledgeGap.findFirst.mockResolvedValue({ id: "gap-1", question: "Aceita Unimed?", agentId: "agent-1", documentId: null, answeredAt: null });
    db.agent.findFirst.mockResolvedValue({ id: "agent-1" });
  });
  const actor = { id: "user-1", label: "dona@clinica.com", role: "clinic" as const };

  it("cria o documento na base do agente e tira da fila", async () => {
    const r = await approveGapAnswer({ tenantId: TENANT, gapId: "gap-1", answer: "Sim, Unimed Nacional.", actor });
    expect(r.ok).toBe(true);
    expect(kb.ingestDocument).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT, agentId: "agent-1" }));
    const call = db.knowledgeGap.updateMany.mock.calls[0][0];
    expect(call.where).toMatchObject({ id: "gap-1", tenantId: TENANT });
    expect(call.data).toMatchObject({ status: "answered", answer: "Sim, Unimed Nacional.", documentId: "doc-1", answeredByRole: "clinic" });
    expect(call.data.answeredAt).toBeInstanceOf(Date);
  });

  it("editar reescreve o mesmo documento e mantém a data da primeira aprovação", async () => {
    const first = new Date("2026-09-01T12:00:00Z");
    db.knowledgeGap.findFirst.mockResolvedValue({ id: "gap-1", question: "Aceita Unimed?", agentId: "agent-1", documentId: "doc-1", answeredAt: first });
    db.knowledgeDocument.findFirst.mockResolvedValue({ id: "doc-1", agentId: "agent-1" });
    await approveGapAnswer({ tenantId: TENANT, gapId: "gap-1", answer: "Só Unimed Nacional.", actor });
    expect(kb.updateDocument).toHaveBeenCalledWith(TENANT, "agent-1", "doc-1", expect.any(Object));
    expect(kb.ingestDocument).not.toHaveBeenCalled();
    expect(db.knowledgeGap.updateMany.mock.calls[0][0].data.answeredAt).toBe(first);
  });

  it("resposta vazia é recusada antes de tocar a base", async () => {
    const r = await approveGapAnswer({ tenantId: TENANT, gapId: "gap-1", answer: "   ", actor });
    expect(r.ok).toBe(false);
    expect(kb.ingestDocument).not.toHaveBeenCalled();
  });
});

describe("retomar quem ficou sem resposta", () => {
  const now = new Date("2026-09-28T12:00:00Z");
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
  const occ = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    askedAt: hoursAgo(2),
    conversation: { id: `c-${id}`, isTest: false, lastInboundAt: hoursAgo(1), followUpReason: null, lead: { phone: `55149999900${id.length}`, isTest: false }, ...over },
  });

  beforeEach(() => {
    db.whatsappInstance.findMany.mockResolvedValue([{ status: "connected", externalId: "inst", provider: "evolution" }]);
  });

  it("envia uma vez para quem pode e deixa de fora quem pediu para parar, saiu da janela ou já foi atendido", async () => {
    db.knowledgeGapOccurrence.findMany.mockResolvedValue([
      occ("a"),
      occ("bb", { followUpReason: "stop" }),
      occ("ccc", { lastInboundAt: hoursAgo(24 * 10) }),
      occ("dddd"),
    ]);
    db.message.count.mockImplementation(async ({ where }: { where: { conversationId: string } }) => (where.conversationId === "c-dddd" ? 1 : 0));

    const r = await resumeGapContacts(TENANT, "gap-1", "Olá! Aceitamos Unimed.", now);
    expect(r).toEqual({ sent: 1, skipped: 3, failed: 0 });
    expect(provider.sendMessage).toHaveBeenCalledTimes(1);
    expect(convo.appendMessage).toHaveBeenCalledWith("c-a", "assistant", "Olá! Aceitamos Unimed.", "human", "wa-1");
    // Não pausa o agente: quem responder depois continua com ele.
    expect(db.conversation.updateMany).not.toHaveBeenCalled();
    // Cada contato é reivindicado antes do envio.
    expect(db.knowledgeGapOccurrence.updateMany).toHaveBeenCalledWith({ where: { id: "a", resumeStatus: null }, data: { resumeStatus: "sending" } });
  });

  it("na Meta respeita a janela de 24h", async () => {
    db.whatsappInstance.findMany.mockResolvedValue([{ status: "connected", externalId: "inst", provider: "meta" }]);
    db.knowledgeGapOccurrence.findMany.mockResolvedValue([occ("a", { lastInboundAt: hoursAgo(30) })]);
    const r = await resumeGapContacts(TENANT, "gap-1", "Olá!", now);
    expect(r.skipped).toBe(1);
    expect(provider.sendMessage).not.toHaveBeenCalled();
    expect(db.knowledgeGapOccurrence.updateMany.mock.calls[0][0].data.resumeNote).toMatch(/24h/);
  });

  it("envio sem confirmação vira falha e não é repetido", async () => {
    db.knowledgeGapOccurrence.findMany.mockResolvedValue([occ("a")]);
    provider.sendMessage.mockRejectedValue(new Error("timeout"));
    const r = await resumeGapContacts(TENANT, "gap-1", "Olá!", now);
    expect(r).toEqual({ sent: 0, skipped: 0, failed: 1 });
    expect(provider.sendMessage).toHaveBeenCalledTimes(1);
    expect(db.knowledgeGapOccurrence.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ resumeStatus: "failed" }) }));
  });

  it("WhatsApp desconectado não consome ninguém", async () => {
    db.whatsappInstance.findMany.mockResolvedValue([{ status: "disconnected", externalId: "inst", provider: "evolution" }]);
    db.knowledgeGapOccurrence.findMany.mockResolvedValue([occ("a")]);
    const r = await resumeGapContacts(TENANT, "gap-1", "Olá!", now);
    expect(r.blocked).toMatch(/não está conectado/);
    expect(db.knowledgeGapOccurrence.updateMany).not.toHaveBeenCalled();
  });
});

describe("retomar com as duas conexões (QR e Meta)", () => {
  const now = new Date("2026-09-28T12:00:00Z");
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
  const QR = { status: "connected", externalId: "inst-qr", provider: "evolution" };
  const META = { status: "connected", externalId: "phone-meta", provider: "meta" };
  const occ = (id: string, whatsappProvider: string | null, hours = 1) => ({
    id,
    askedAt: hoursAgo(hours + 1),
    conversation: {
      id: `c-${id}`, isTest: false, lastInboundAt: hoursAgo(hours), followUpReason: null,
      whatsappProvider, lead: { phone: `5514999990${id}`, isTest: false },
    },
  });

  beforeEach(() => {
    db.whatsappInstance.findMany.mockResolvedValue([QR, META]);
    db.message.count.mockResolvedValue(0);
  });

  it("cada contato volta pelo número em que perguntou", async () => {
    db.knowledgeGapOccurrence.findMany.mockResolvedValue([occ("01", "meta"), occ("02", "evolution")]);

    const r = await resumeGapContacts(TENANT, "gap-1", "Aceitamos Unimed.", now);

    expect(r).toEqual({ sent: 2, skipped: 0, failed: 0 });
    expect(provider.sendMessage).toHaveBeenNthCalledWith(1, "phone-meta", "551499999001", "Aceitamos Unimed.");
    expect(provider.sendMessage).toHaveBeenNthCalledWith(2, "inst-qr", "551499999002", "Aceitamos Unimed.");
  });

  it("o número do contato fora do ar deixa a retomada pendente — o outro não o substitui", async () => {
    // Voltar pelo QR a quem só falou com o número oficial seria primeiro contato.
    db.whatsappInstance.findMany.mockResolvedValue([QR, { ...META, status: "disconnected" }]);
    db.knowledgeGapOccurrence.findMany.mockResolvedValue([occ("01", "meta"), occ("02", "evolution")]);

    const r = await resumeGapContacts(TENANT, "gap-1", "Aceitamos Unimed.", now);

    expect(r).toEqual({ sent: 1, skipped: 0, failed: 0, waiting: 1 });
    expect(provider.sendMessage).toHaveBeenCalledOnce();
    expect(provider.sendMessage).toHaveBeenCalledWith("inst-qr", "551499999002", "Aceitamos Unimed.");
    // Quem espera não é reivindicado nem marcado: uma nova tentativa o encontra.
    expect(db.knowledgeGapOccurrence.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "01" }) }),
    );
  });

  it("a janela é a do número do contato, mesmo com esse número desconectado", async () => {
    db.whatsappInstance.findMany.mockResolvedValue([QR, { ...META, status: "disconnected" }]);
    db.knowledgeGapOccurrence.findMany.mockResolvedValue([occ("01", "meta", 30)]);

    const r = await resumeGapContacts(TENANT, "gap-1", "Olá!", now);

    // 30h passou das 24h da Meta: sai da fila em vez de esperar para sempre.
    expect(r).toEqual({ sent: 0, skipped: 1, failed: 0 });
    expect(db.knowledgeGapOccurrence.updateMany.mock.calls[0][0].data.resumeNote).toMatch(/24h/);
  });

  it("contato do QR com 30h de silêncio ainda está na janela de 7 dias", async () => {
    db.knowledgeGapOccurrence.findMany.mockResolvedValue([occ("02", "evolution", 30)]);

    const r = await resumeGapContacts(TENANT, "gap-1", "Olá!", now);

    expect(r).toEqual({ sent: 1, skipped: 0, failed: 0 });
    expect(provider.sendMessage).toHaveBeenCalledWith("inst-qr", "551499999002", "Olá!");
  });

  it("nenhuma conexão de pé: ninguém é tentado, como antes", async () => {
    db.whatsappInstance.findMany.mockResolvedValue([
      { ...QR, status: "disconnected" },
      { ...META, status: "disconnected" },
    ]);
    db.knowledgeGapOccurrence.findMany.mockResolvedValue([occ("01", "meta")]);

    const r = await resumeGapContacts(TENANT, "gap-1", "Olá!", now);

    expect(r.blocked).toMatch(/não está conectado/);
    expect(db.knowledgeGapOccurrence.updateMany).not.toHaveBeenCalled();
  });

  it("a tela diz quantos esperam a reconexão", () => {
    expect(describeResume({ sent: 1, skipped: 0, failed: 0, waiting: 2 })).toMatch(
      /1 contato recebeu a resposta, 2 aguardam a reconexão do número por onde falam./,
    );
    expect(describeResume({ sent: 0, skipped: 0, failed: 0, waiting: 1 })).toMatch(/1 aguarda a reconexão/);
  });
});

describe("avisos para a equipe", () => {
  it("o aviso leva a pergunta e o link, nunca dados do contato", () => {
    const text = formatGapNotice(
      Array.from({ length: 7 }, (_, i) => ({ question: `Pergunta ${i + 1}?`, askedCount: 1 })),
      "https://app.fechai.com/perguntas",
    );
    expect(text).toContain("7 perguntas");
    expect(text).toContain("e mais 2");
    expect(text).toContain("https://app.fechai.com/perguntas");
  });

  it("reivindica cada pergunta uma vez e só avisa a clínica que responde a fila", async () => {
    const now = new Date("2026-09-28T12:00:00Z");
    db.knowledgeGap.findMany.mockResolvedValue([
      { id: "g1", tenantId: "t1", question: "Aceita Unimed?", askedCount: 1, createdAt: now },
      { id: "g2", tenantId: "t2", question: "Tem estacionamento?", askedCount: 1, createdAt: now },
      { id: "g3", tenantId: "t1", question: "Pergunta velha?", askedCount: 1, createdAt: new Date(now.getTime() - 7 * 3_600_000) },
    ]);
    db.knowledgeGapSettings.findMany.mockResolvedValue([{ tenantId: "t2", responders: "mavellium" }]);
    db.user.findMany.mockResolvedValue([{ email: "dona@clinica.com" }]);

    expect(await sendGapNotices(now)).toBe(1);
    expect(db.knowledgeGap.updateMany).toHaveBeenCalledTimes(3);
    expect(mail.sendMail).toHaveBeenCalledTimes(1);
    const sent = (mail.sendMail.mock.calls[0] as unknown as [{ to: string; text: string }])[0];
    expect(sent.to).toBe("dona@clinica.com");
    expect(sent.text).toContain("Aceita Unimed?");
    expect(sent.text).not.toContain("Pergunta velha?");
    expect(sent.text).not.toContain("estacionamento");
  });
});

describe("aviso no grupo com as duas conexões", () => {
  const now = new Date("2026-09-28T12:00:00Z");
  const GRUPO = "120363012345678901@g.us";
  const QR = { status: "connected", externalId: "inst-qr", provider: "evolution" };
  const META = { status: "connected", externalId: "phone-meta", provider: "meta" };

  beforeEach(() => {
    db.knowledgeGap.findMany.mockResolvedValue([
      { id: "g1", tenantId: "t1", question: "Aceita Unimed?", askedCount: 1, createdAt: now },
    ]);
    db.knowledgeGapSettings.findMany.mockResolvedValue([
      { tenantId: "t1", notifyEmail: false, notifyWhatsapp: true, groupId: GRUPO },
    ]);
  });

  it("o grupo é do número por QR code: sai por ele mesmo com a Meta também conectada", async () => {
    db.whatsappInstance.findMany.mockResolvedValue([META, QR]);

    expect(await sendGapNotices(now)).toBe(1);

    expect(provider.sendGroupMessage).toHaveBeenCalledOnce();
    expect(provider.sendGroupMessage).toHaveBeenCalledWith("inst-qr", GRUPO, expect.stringContaining("Aceita Unimed?"));
  });

  it("só a Meta de pé: não há grupo, e o aviso não é enviado por ela", async () => {
    db.whatsappInstance.findMany.mockResolvedValue([META]);

    expect(await sendGapNotices(now)).toBe(0);

    expect(provider.sendGroupMessage).not.toHaveBeenCalled();
  });
});

describe("relatório mensal", () => {
  it("tempo médio da equipe entra no mês da aprovação", () => {
    const input = roiInput();
    const r = calculateMonthlyMetrics({
      ...input,
      gaps: [
        { agentId: null, firstAskedAt: new Date("2026-09-10T12:00:00Z"), answeredAt: new Date("2026-09-10T14:00:00Z") },
        { agentId: null, firstAskedAt: new Date("2026-09-11T12:00:00Z"), answeredAt: new Date("2026-09-11T16:00:00Z") },
        { agentId: null, firstAskedAt: new Date("2026-08-20T12:00:00Z"), answeredAt: new Date("2026-08-25T12:00:00Z") },
      ],
    });
    expect(r.gapsAnswered).toBe(2);
    expect(r.gapAnswerSeconds).toBe(3 * 3600);
    expect(calculateMonthlyMetrics(input).gapAnswerSeconds).toBeNull();
  });
});
