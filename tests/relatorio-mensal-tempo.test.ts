import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/modules/scheduling/clinicorp", () => ({ readClinicorpReport: vi.fn() }));
import { PDFDocument } from "pdf-lib";
import { audioDurationSeconds } from "@/modules/voice/received-audio";
import { calculateMonthlyMetrics, type MonthlyMetrics } from "@/modules/reports/monthly";
import { applyMonthlyOverrides } from "@/modules/reports/monthly-overrides";
import { monthlyAssumptionsSchema, parseMonthlyAssumptions } from "@/modules/reports/monthly-config";
import { calculateTimeMetrics, featuredCaseProblem, FEATURED_CASE_MAX, formatDuration, timeHeadline,
  type MonthlyTimeMetrics, type TimeAppointment, type TimeConversation, type TimeEvent, type TimeMessage } from "@/modules/reports/monthly-time";
import { generateMonthlyPdf } from "@/modules/reports/monthly-pdf";
import { MonthlyView } from "@/app/(dashboard)/relatorios/MonthlyView";
import { oggPage, opusAudio } from "./fixtures/ogg";
import { roiConfig, roiFixture, roiInput } from "./fixtures/monthly-roi";

const start = new Date("2026-09-01T03:00:00Z"), end = new Date("2026-10-01T03:00:00Z");
const user = (at: string, audio?: TimeMessage["audio"]): TimeMessage => ({ role: "user", sentBy: null, createdAt: new Date(at), audio });
const agent = (at: string): TimeMessage => ({ role: "assistant", sentBy: "agent", createdAt: new Date(at) });
const human = (at: string): TimeMessage => ({ role: "assistant", sentBy: "human", createdAt: new Date(at) });
const heard = (seconds: number | null) => ({ seconds, heard: true });
const conversation = (id: string, messages: TimeMessage[], lead: TimeConversation["lead"] = {}): TimeConversation => ({ id, leadId: `lead-${id}`, lead, messages });
const booked = (conversationId: string, at: string, status = "scheduled", source = "agent"): TimeAppointment =>
  ({ conversationId, leadId: `lead-${conversationId}`, source, status, createdAt: new Date(at) });
const time = (conversations: TimeConversation[], appointments: TimeAppointment[] = [], events: TimeEvent[] = []) =>
  calculateTimeMetrics({ start, end, conversations, appointments, events });

describe("duração do áudio recebido", () => {
  it("lê a nota de voz OGG/Opus descontando o pre-skip", () => {
    expect(audioDurationSeconds(opusAudio(256))).toBe(256);
    expect(audioDurationSeconds(opusAudio(288.4, 3840))).toBe(288);
  });
  it("ignora página final sem posição e página de outro fluxo", () => {
    expect(audioDurationSeconds(Buffer.concat([opusAudio(120), oggPage(7, BigInt(-1), Buffer.alloc(10))]))).toBe(120);
    expect(audioDurationSeconds(Buffer.concat([opusAudio(60), oggPage(99, BigInt(48_000 * 999), Buffer.alloc(5))]))).toBe(60);
  });
  it("lê OGG/Vorbis pela taxa do cabeçalho", () => {
    const head = Buffer.alloc(30); head[0] = 1; head.write("vorbis", 1, "latin1"); head[11] = 1; head.writeUInt32LE(44_100, 12);
    expect(audioDurationSeconds(Buffer.concat([oggPage(3, BigInt(0), head, 2), oggPage(3, BigInt(44_100 * 30), Buffer.alloc(50), 4)]))).toBe(30);
  });
  it("formato desconhecido, truncado ou vazio fica sem medição, nunca zero", () => {
    expect(audioDurationSeconds(Buffer.from("ID3\u0004 mp3 qualquer"))).toBeNull();
    expect(audioDurationSeconds(opusAudio(10).subarray(0, 40))).toBeNull();
    expect(audioDurationSeconds(Buffer.alloc(0))).toBeNull();
  });
});

describe("áudios e mensagens assumidos pelo agente", () => {
  it("conta só o que o agente respondeu, ouvido e dentro do mês", () => {
    const t = time([
      conversation("a", [
        user("2026-09-14T10:00:00Z"), user("2026-09-14T10:01:00Z", heard(256)), user("2026-09-14T10:02:00Z", heard(288)), agent("2026-09-14T10:03:00Z"),
        // Sem transcrição a IA não ouviu: nem áudio, nem mensagem.
        user("2026-09-14T11:00:00Z", { seconds: 30, heard: false }), user("2026-09-14T11:01:00Z"), agent("2026-09-14T11:02:00Z"),
        // Quem respondeu foi a equipe.
        user("2026-09-14T12:00:00Z", heard(60)), human("2026-09-14T12:05:00Z"),
        // Ouvido, mas recebido antes da medição.
        user("2026-09-14T13:00:00Z", heard(null)), agent("2026-09-14T13:01:00Z"),
      ]),
      conversation("agosto", [user("2026-08-31T20:00:00Z", heard(500)), agent("2026-08-31T20:01:00Z")]),
    ]);
    expect(t).toMatchObject({ textMessages: 2, audios: 3, unmeasuredAudios: 1, audioMinutes: 9.07, longAudios: 2, longestAudioSeconds: 288 });
  });
  it("mensagem sem resposta ainda não conta", () => {
    expect(time([conversation("a", [user("2026-09-14T10:00:00Z", heard(300))])])).toMatchObject({ audios: 0, textMessages: 0, longestAudioSeconds: null });
  });
});

describe("duração dos atendimentos", () => {
  const conversations = [
    conversation("s", [user("2026-09-10T12:00:00Z"), agent("2026-09-10T12:01:00Z"), user("2026-09-10T12:30:00Z"), agent("2026-09-10T12:31:00Z"), user("2026-09-10T13:00:00Z"), agent("2026-09-10T13:01:00Z")]),
    conversation("h", [user("2026-09-11T12:00:00Z"), agent("2026-09-11T12:10:00Z")]),
    conversation("l", [user("2026-09-12T12:00:00Z"), agent("2026-09-12T12:05:00Z"), user("2026-09-15T12:00:00Z"), agent("2026-09-15T12:20:00Z")], { status: "lost" }),
    conversation("d", [user("2026-09-16T12:00:00Z"), agent("2026-09-16T12:01:00Z")], { status: "lost", disqualifiedAt: new Date("2026-09-16T12:01:00Z") }),
    conversation("proativa", [agent("2026-09-17T12:00:00Z")]),
    conversation("equipe", [user("2026-09-18T12:00:00Z"), human("2026-09-18T12:01:00Z")]),
    conversation("c", [user("2026-09-19T12:00:00Z"), agent("2026-09-19T12:10:00Z")]),
  ];
  const appointments = [booked("s", "2026-09-10T12:30:30Z"), booked("c", "2026-09-19T12:05:00Z", "canceled"), booked("d", "2026-09-16T12:00:30Z", "scheduled", "manual")];
  // A reação do atendente não é mensagem: chega depois da última, no mesmo atendimento.
  const events = [{ conversationId: "h", kind: "handoff", createdAt: new Date("2026-09-11T12:20:00Z") }];

  it("separa por resultado: agendou, transbordou, perdido e sem desfecho", () => {
    const t = time(conversations, appointments, events);
    expect(t.sessions.scheduled).toEqual({ count: 1, averageMinutes: 61, medianMinutes: 61, averageMessages: 6 });
    expect(t.sessions.handoff).toEqual({ count: 1, averageMinutes: 10, medianMinutes: 10, averageMessages: 2 });
    // Perdido é o estado atual: só o último atendimento do contato; desqualificado não é perdido.
    expect(t.sessions.lost).toEqual({ count: 1, averageMinutes: 20, medianMinutes: 20, averageMessages: 2 });
    expect(t.sessions.other).toMatchObject({ count: 3, medianMinutes: 5 });
    expect(t.sessions.all).toMatchObject({ count: 6, averageMinutes: 17.8, medianMinutes: 10 });
  });
  it("mede o tempo e as mensagens até o agendamento feito pelo agente", () => {
    expect(time(conversations, appointments, events).toSchedule).toEqual({ count: 1, averageMinutes: 30.5, medianMinutes: 30.5, averageMessages: 3 });
    const three = [0, 1, 2].map((i) => conversation(`m${i}`, [user(`2026-09-2${i}T12:00:00Z`), agent(`2026-09-2${i}T12:0${i}:30Z`)]));
    const at = (i: number, minutes: number) => new Date(new Date(`2026-09-2${i}T12:00:00Z`).getTime() + minutes * 60_000).toISOString();
    const t = time(three, [booked("m0", at(0, 10)), booked("m1", at(1, 20)), booked("m2", at(2, 90))]);
    expect(t.toSchedule).toMatchObject({ count: 3, averageMinutes: 40, medianMinutes: 20 });
  });
  it("24h de silêncio encerram o atendimento; mensagem nossa não abre outro", () => {
    const t = time([
      conversation("x", [user("2026-09-20T10:00:00Z"), agent("2026-09-20T10:01:00Z"), agent("2026-09-22T10:00:00Z"),
        user("2026-09-22T11:00:00Z"), agent("2026-09-22T11:01:00Z")]),
      conversation("y", [user("2026-09-25T10:00:00Z"), agent("2026-09-25T10:01:00Z"), agent("2026-09-25T10:31:00Z")]),
      // Começou em agosto: pertence ao relatório de agosto.
      conversation("z", [user("2026-08-31T20:00:00Z"), agent("2026-09-01T10:00:00Z")]),
    ]);
    expect(t.sessions.all).toMatchObject({ count: 3, medianMinutes: 1 });
    expect(t.sessions.all.averageMinutes).toBeCloseTo(11, 0);
  });
});

describe("economia pelo tempo medido", () => {
  const withAudio = () => {
    const input = roiInput(); input.config.secondsPerMessage = 30;
    input.conversations[0].messages.splice(1, 0, { id: "audio", role: "user", sentBy: null, createdAt: new Date("2026-09-14T10:00:05Z"), audio: heard(540) });
    return input;
  };
  it("soma minutos de áudio e o tempo de cada mensagem respondida", () => {
    const m = calculateMonthlyMetrics(withAudio());
    // (540 s de áudio + 2 mensagens × 30 s) ÷ 3600 = 1/6 h; custo/hora R$ 10,00.
    expect(m.assumedHours).toBeCloseTo(1 / 6); expect(m.savingsCents).toBe(167);
    expect(m.revenueCents).toBe(50_000); expect(m.roiPercent).toBe(401.7);
  });
  it("sem tempo por mensagem continua a estimativa por conversa", () => {
    const input = withAudio(); input.config.secondsPerMessage = null;
    expect(calculateMonthlyMetrics(input).assumedHours).toBe(0.1);
  });
  it("correções: horas manuais vencem; minutos de áudio ajustados recalculam", () => {
    const input = withAudio(), m = calculateMonthlyMetrics(input);
    expect(applyMonthlyOverrides(m, { assumedHours: 2 }, input.config).savingsCents).toBe(2000);
    expect(applyMonthlyOverrides(m, { time: { audioMinutes: 60 } }, input.config).savingsCents).toBe(1017);
  });
  it("relatório fechado antes da medição volta à estimativa por conversa", () => {
    const input = withAudio(), m = calculateMonthlyMetrics(input);
    const old = { ...m } as MonthlyMetrics; delete old.time;
    expect(applyMonthlyOverrides(old, {}, input.config).assumedHours).toBe(0.1);
  });
  it("premissas salvas antes do campo continuam válidas", () => {
    const saved: Record<string, unknown> = { ...roiConfig() }; delete saved.secondsPerMessage;
    expect(parseMonthlyAssumptions(saved)).toEqual(roiConfig());
    expect(monthlyAssumptionsSchema.safeParse({ ...roiConfig(), secondsPerMessage: 0 }).success).toBe(false);
    expect(monthlyAssumptionsSchema.safeParse({ ...roiConfig(), secondsPerMessage: 601 }).success).toBe(false);
  });
});

describe("texto do bloco", () => {
  it("formata durações como no relatório", () => {
    expect([45, 256, 300, 11_520, 64_800, 3 * 86_400 + 4 * 3600].map(formatDuration)).toEqual(["45s", "4min16s", "5min", "3h12", "18h", "3d 4h"]);
    expect(formatDuration(null)).toBe("—");
  });
  it("resume o mês numa frase", () => {
    const t = { audioMinutes: 192, audios: 40 } as MonthlyTimeMetrics;
    const text = timeHeadline(t, 214, 18, 123_400);
    expect(text).toMatch(/^Este mês o agente ouviu 3h12 de áudios e atendeu 214 conversas, o equivalente a 18h de trabalho da recepção \(R\$\s1\.234,00\)\.$/);
    expect(timeHeadline({ audioMinutes: 0, audios: 0 } as MonthlyTimeMetrics, 1, null, null)).toBe("Este mês o agente atendeu 1 conversa.");
  });
});

describe("caso do mês anonimizado", () => {
  const names = ["Maria Aparecida dos Santos", "Dra. Ana", "Mãe", null];
  it("aceita o perfil genérico", () => {
    expect(featuredCaseProblem("Uma paciente de 74 anos enviou 2 áudios de quase 5 minutos; a mãe da paciente agradeceu.", names)).toBeNull();
  });
  it("recusa nome, telefone, documento, e-mail e texto que não cabe", () => {
    expect(featuredCaseProblem("A dona Aparecida mandou áudios.", names)).toContain("aparecida");
    expect(featuredCaseProblem("Ligar em (11) 98765-4321.", names)).toContain("telefone");
    expect(featuredCaseProblem("CPF 123.456.789-00", names)).toContain("documento");
    expect(featuredCaseProblem("Contato: paciente@exemplo.com", names)).toContain("e-mail");
    expect(featuredCaseProblem("a".repeat(FEATURED_CASE_MAX + 1), names)).toContain(`${FEATURED_CASE_MAX}`);
  });
});

describe("bloco na tela do relatório", () => {
  const demo: MonthlyTimeMetrics = { textMessages: 1480, audios: 212, audioMinutes: 192, unmeasuredAudios: 3, longAudios: 31, longestAudioSeconds: 288,
    sessions: { all: { count: 214, averageMinutes: 38, medianMinutes: 12, averageMessages: 14 }, scheduled: { count: 52, averageMinutes: 46, medianMinutes: 21, averageMessages: 18 },
      handoff: { count: 19, averageMinutes: 64, medianMinutes: 30, averageMessages: 22 }, lost: { count: 23, averageMinutes: 15, medianMinutes: 8, averageMessages: 7 },
      other: { count: 120, averageMinutes: 31, medianMinutes: 10, averageMessages: 12 } },
    toSchedule: { count: 52, averageMinutes: 130, medianMinutes: 45, averageMessages: 14 } };
  const render = (report: ReturnType<typeof roiFixture>) => renderToStaticMarkup(createElement(MonthlyView, { report }));
  it("mostra frase, áudios, duração por resultado, caso e premissas", () => {
    const report = roiFixture(); report.assumptions.secondsPerMessage = 30;
    report.featuredCase = "Uma paciente de 74 anos enviou 2 áudios de quase 5 minutos.";
    report.current = applyMonthlyOverrides({ ...report.current, time: demo }, {}, report.assumptions);
    const html = render(report);
    expect(html).toContain("Tempo que o Fechai devolveu para sua equipe");
    expect(html).toContain("Este mês o agente ouviu 3h12 de áudios");
    expect(html).toContain("maior: 4min48s"); expect(html).toContain("Transbordou para a equipe");
    expect(html).toContain("mediana de 45min"); expect(html).toContain("Uma paciente de 74 anos");
    expect(html).toContain("3 áudio(s) sem duração medida");
    expect(html).toContain("× 30 s de leitura e resposta");
  });
  it("relatório fechado antes do bloco não mostra tempo nem zera áudios", () => {
    const report = roiFixture(); delete report.current.time; delete report.previous.time;
    const html = render(report);
    expect(html).not.toContain("Tempo que o Fechai devolveu"); expect(html).toContain("Não medido");
  });
});

describe("PDF com o tempo devolvido", () => {
  const stats = (count: number) => ({ count, averageMinutes: 1234.5, medianMinutes: 987.6, averageMessages: 23.4 });
  it("resumo executivo cabe na página 1 com conteúdo máximo e caso do mês", async () => {
    const report = roiFixture();
    report.assumptions.secondsPerMessage = 30;
    report.agentNames = Array.from({ length: 5 }, (_, i) => `Agente de atendimento com nome extenso ${i}`);
    report.adjustments = "Revisamos a abordagem do agente e conferimos as informações. ".repeat(7).slice(0, 400);
    report.nextMonth = report.adjustments;
    report.assumptions.procedures = Array.from({ length: 12 }, (_, i) => ({ name: `Procedimento de avaliação com nome extenso e referência ${i}`, ticketCents: 100_000, conversionBps: 5000 }));
    report.featuredCase = "Uma paciente de 74 anos enviou 2 áudios de quase 5 minutos. ".repeat(6).slice(0, FEATURED_CASE_MAX);
    const heavy: MonthlyTimeMetrics = { textMessages: 18_400, audios: 3120, audioMinutes: 12_345.5, unmeasuredAudios: 270, longAudios: 580, longestAudioSeconds: 1795,
      sessions: { all: stats(4200), scheduled: stats(960), handoff: stats(410), lost: stats(330), other: stats(2500) }, toSchedule: stats(960) };
    report.current = applyMonthlyOverrides({ ...report.current, time: heavy }, {}, report.assumptions);
    expect((await PDFDocument.load(await generateMonthlyPdf(report))).getPageCount()).toBeGreaterThanOrEqual(2);
  });
  it("relatório fechado antes do bloco continua exportando", async () => {
    const report = roiFixture(); delete report.current.time; delete report.previous.time; delete report.featuredCase;
    expect((await PDFDocument.load(await generateMonthlyPdf(report))).getPageCount()).toBeGreaterThanOrEqual(2);
  });
});
