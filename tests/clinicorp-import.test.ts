import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { encryptSecret } from "@/lib/crypto";

/**
 * Importação da agenda do Clinicorp (o que a recepção marca direto lá).
 *
 * O estrago que cada regra evita:
 *
 * - paciente da recepção sem lembrete (o motivo de a importação existir);
 * - a consulta que o próprio fechai enviou voltando como duplicata, e o
 *   paciente recebendo cada lembrete duas vezes;
 * - lembrete de consulta que a clínica desmarcou;
 * - uma resposta incompleta da API derrubando consultas de verdade;
 * - "falta uma semana" chegando para a consulta de depois de amanhã, no dia em
 *   que a importação é ligada e a agenda inteira chega de uma vez;
 * - reagendamento do agente desfeito pelo horário antigo que ficou lá.
 */

const db = vi.hoisted(() => ({
  clinicorpIntegration: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  calendarFeatures: { findUnique: vi.fn() },
  agent: { findFirst: vi.fn() },
  appointment: { findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  lead: { findMany: vi.fn(), findFirst: vi.fn() },
}));
const google = vi.hoisted(() => ({ deleteEventFromGoogle: vi.fn(async () => true) }));
const conversation = vi.hoisted(() => ({ getOrCreateConversation: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/modules/scheduling/google", () => google);
vi.mock("@/modules/agent-engine/conversation", () => conversation);

import {
  clinicorpPhoneToWhatsApp,
  contactForImportedAppointment,
  importClinicorpAppointments,
  syncClinicorpAppointments,
} from "@/modules/scheduling/clinicorp-import";

const CONTA = "tenant-1";
const AGORA = new Date("2026-09-28T12:00:00.000Z"); // 09:00 em Brasília
const UM_DIA = 24 * 60;
const UMA_SEMANA = 7 * UM_DIA;
const ID = "5000000000000001";
const INICIO = new Date("2026-10-01T17:00:00.000Z"); // 01/10 14:00 em Brasília
const FIM = new Date("2026-10-01T17:30:00.000Z");

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const item = (over: Record<string, unknown> = {}) => ({
  ItemType: "APPOINTMENT", id: Number(ID), AtomicDate: 20261001, fromTime: "14:00", toTime: "14:30",
  PatientName: "Ana Lima", MobilePhone: "(47) 98870-0805", ...over,
});
const importada = (over: Record<string, unknown> = {}) => ({
  id: "local-importada", source: "clinicorp", status: "scheduled", startsAt: INICIO, endsAt: FIM,
  title: "Ana Lima", patientName: "Ana Lima", patientPhone: "5547988700805", leadId: null,
  googleEventId: null, reminderOverride: null, clinicorpSeenAt: new Date(AGORA.getTime() - 10 * 60_000),
  updatedAt: new Date(AGORA.getTime() - 10 * 60_000), clinicorpAppointmentId: ID, ...over,
});
const doFechai = (over: Record<string, unknown> = {}) => ({
  ...importada(), id: "local-fechai", source: "agent", patientPhone: null, clinicorpSeenAt: null,
  googleEventId: "google-1", updatedAt: new Date(AGORA.getTime() - 60 * 60_000), ...over,
});

let integration: Record<string, unknown>;
let agenda: unknown[];
let linked: unknown[];
let ours: unknown[];
let fetchMock: ReturnType<typeof vi.fn>;

/** As chamadas de updateMany que miram uma linha específica. */
const updatesOf = (id: string) =>
  db.appointment.updateMany.mock.calls.map(([args]) => args).filter((args) => args.where.id === id);
/** A chamada que tira da agenda o que sumiu do Clinicorp. */
const absenceCall = () =>
  db.appointment.updateMany.mock.calls.map(([args]) => args).find((args) => args.where.clinicorpSeenAt);

function lembretes(reminders: unknown[]) {
  db.agent.findFirst.mockResolvedValue({
    actions: [{ enabled: true, config: { reminderEnabled: true, reminders, timezone: "America/Sao_Paulo" } }],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ENCRYPTION_KEY", "chave-de-testes-com-mais-de-32-caracteres");
  integration = {
    tenantId: CONTA, apiUser: encryptSecret("usuario"), apiToken: encryptSecret("token"), subscriberId: "assinante",
    businessId: "4791226171916288", dentistId: null, importAppointments: true, syncEnabled: true, checkAvailability: true,
  };
  agenda = [];
  linked = [];
  ours = [];
  db.clinicorpIntegration.findUnique.mockImplementation(async () => integration);
  db.clinicorpIntegration.update.mockResolvedValue({});
  db.calendarFeatures.findUnique.mockResolvedValue({ clinicorpEnabled: true, googleEnabled: false });
  db.agent.findFirst.mockResolvedValue(null);
  db.appointment.findMany.mockImplementation(async ({ where }) => (where.clinicorpAppointmentId ? linked : ours));
  db.appointment.create.mockResolvedValue({});
  // A limpeza de ausentes (a única com `clinicorpSeenAt` no where) não acha nada
  // por padrão; as outras escritas acertam a linha que miraram.
  db.appointment.updateMany.mockImplementation(async ({ where }) => ({ count: where.clinicorpSeenAt ? 0 : 1 }));
  db.lead.findMany.mockResolvedValue([]);
  fetchMock = vi.fn(async () => json(agenda));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("trazer o que a recepção marcou", () => {
  it("cria a consulta importada no horário da clínica, com o celular no formato do WhatsApp", async () => {
    agenda = [item()];

    expect(await syncClinicorpAppointments(CONTA, AGORA)).toEqual({ status: "ok", created: 1, updated: 0, removed: 0 });

    expect(db.appointment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: CONTA, source: "clinicorp", clinicorpAppointmentId: ID, title: "Ana Lima", patientName: "Ana Lima",
        patientPhone: "5547988700805", startsAt: INICIO, endsAt: FIM, leadId: null, conversationId: null,
        clinicorpSeenAt: AGORA, remindersSent: [],
      }),
    });
    // O resultado vai para o card da importação, sem tocar no aviso de envio.
    expect(db.clinicorpIntegration.update).toHaveBeenCalledWith({
      where: { tenantId: CONTA }, data: { lastImportAt: expect.any(Date), lastImportError: null },
    });
  });

  it("lê de hoje até o lembrete mais distante, em pedaços de um mês, com desmarcados e excluídos", async () => {
    await syncClinicorpAppointments(CONTA, AGORA);

    const urls = fetchMock.mock.calls.map(([url]) => url as URL);
    expect(urls.map((u) => [u.searchParams.get("from"), u.searchParams.get("to")])).toEqual([
      ["2026-09-28", "2026-10-28"],
      ["2026-10-29", "2026-11-24"],
    ]);
    for (const url of urls) {
      expect(url.pathname).toMatch(/\/appointment\/list$/);
      expect(url.searchParams.get("businessId")).toBe("4791226171916288");
      expect(url.searchParams.get("includeCanceled")).toBe("X");
      expect(url.searchParams.get("includeDeleted")).toBe("X");
      // Compromisso e bloqueio de agenda não são paciente: não recebem lembrete.
      expect(url.searchParams.get("includeAssigns")).toBeNull();
    }
  });

  it("usa o contato que já existe, mesmo gravado sem o nono dígito", async () => {
    agenda = [item()];
    db.lead.findMany.mockResolvedValue([{ id: "lead-1", phone: "554788700805", conversation: { id: "conv-1" } }]);

    await syncClinicorpAppointments(CONTA, AGORA);

    expect(db.lead.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId: CONTA, isTest: false, phone: { in: expect.arrayContaining(["5547988700805", "554788700805"]) } }),
    }));
    expect(db.appointment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ leadId: "lead-1", conversationId: "conv-1" }),
    });
  });

  it("com profissional fixado, traz só a agenda dele", async () => {
    integration.dentistId = "222";
    agenda = [item({ id: 1, Dentist_PersonId: 333 }), item({ id: 2, Dentist_PersonId: 222 })];

    await syncClinicorpAppointments(CONTA, AGORA);

    expect(db.appointment.create).toHaveBeenCalledTimes(1);
    expect(db.appointment.create).toHaveBeenCalledWith({ data: expect.objectContaining({ clinicorpAppointmentId: "2" }) });
  });

  it("não traz o que já veio desmarcado", async () => {
    agenda = [item({ Canceled: "X" }), item({ id: 2, Deleted: "X" })];
    await syncClinicorpAppointments(CONTA, AGORA);
    expect(db.appointment.create).not.toHaveBeenCalled();
  });

  it("sem AtomicDate, lê o dia pela data — e deixa de fora o que não dá para saber", async () => {
    agenda = [
      // Dia local à meia-noite UTC (o formato que a criação por API recebe).
      item({ id: 1, AtomicDate: undefined, date: "2026-10-01T00:00:00.000Z", fromTime: "09:00", toTime: "09:30" }),
      // Instante de verdade, batendo com o início.
      item({ id: 2, AtomicDate: undefined, date: "2026-10-01T12:00:00.000Z", fromTime: "09:00", toTime: "09:30" }),
      // Meia-noite UTC do dia 2 é 21:00 do dia 1 em Brasília: pode ser qualquer um dos dois.
      item({ id: 3, AtomicDate: undefined, date: "2026-10-02T00:00:00.000Z", fromTime: "21:00", toTime: "21:30" }),
      // Instante que não bate com o início (data de criação, por exemplo).
      item({ id: 4, AtomicDate: undefined, date: "2026-10-01T18:02:36.132Z", fromTime: "09:00", toTime: "09:30" }),
    ];

    await syncClinicorpAppointments(CONTA, AGORA);

    const created = db.appointment.create.mock.calls.map(([args]) => args.data);
    expect(created.map((d) => d.clinicorpAppointmentId)).toEqual(["1", "2"]);
    for (const data of created) expect(data.startsAt).toEqual(new Date("2026-10-01T12:00:00.000Z"));
  });
});

describe("sem duplicar", () => {
  it("não traz de volta o que o próprio fechai enviou ao Clinicorp", async () => {
    agenda = [item()];
    linked = [doFechai({ startsAt: new Date("2026-10-02T17:00:00.000Z") })];

    await syncClinicorpAppointments(CONTA, AGORA);

    expect(db.appointment.create).not.toHaveBeenCalled();
    // O horário da consulta do fechai é o daqui: seguir o de lá desfaria um
    // reagendamento cujo cancelamento no Clinicorp falhou.
    expect(updatesOf("local-fechai")).toEqual([]);
  });

  it("espera o envio do fechai em andamento gravar o id", async () => {
    agenda = [item()];
    ours = [{ leadId: null, startsAt: INICIO, endsAt: FIM, createdAt: new Date(AGORA.getTime() - 2 * 60_000), clinicorpAppointmentId: null }];

    await syncClinicorpAppointments(CONTA, AGORA);

    expect(db.appointment.create).not.toHaveBeenCalled();
  });

  it("não traz o que o mesmo contato já tem marcado pelo fechai no mesmo horário", async () => {
    agenda = [item()];
    db.lead.findMany.mockResolvedValue([{ id: "lead-1", phone: "5547988700805", conversation: { id: "conv-1" } }]);
    ours = [{ leadId: "lead-1", startsAt: INICIO, endsAt: FIM, createdAt: new Date("2026-09-01T12:00:00Z"), clinicorpAppointmentId: "777" }];

    await syncClinicorpAppointments(CONTA, AGORA);

    expect(db.appointment.create).not.toHaveBeenCalled();
  });
});

describe("quem vence em divergência", () => {
  it("a consulta do fechai que a clínica desmarcou lá sai daqui, com o evento do Google", async () => {
    agenda = [item({ Canceled: "X" })];
    const row = doFechai();
    linked = [row];

    await syncClinicorpAppointments(CONTA, AGORA);

    expect(updatesOf("local-fechai")).toEqual([{
      where: { id: "local-fechai", tenantId: CONTA, status: "scheduled", clinicorpAppointmentId: ID, updatedAt: row.updatedAt },
      data: { status: "canceled" },
    }]);
    expect(google.deleteEventFromGoogle).toHaveBeenCalledWith(CONTA, "google-1");
  });

  it("não mexe na consulta do fechai alterada há pouco (reagendamento em andamento)", async () => {
    agenda = [item({ Canceled: "X" })];
    linked = [doFechai({ updatedAt: new Date(AGORA.getTime() - 2 * 60_000) })];

    await syncClinicorpAppointments(CONTA, AGORA);

    expect(updatesOf("local-fechai")).toEqual([]);
    expect(google.deleteEventFromGoogle).not.toHaveBeenCalled();
  });

  it("a importada remarcada lá muda de horário e ganha lembretes novos", async () => {
    lembretes([{ minutesBefore: UMA_SEMANA, template: "semana" }, { minutesBefore: UM_DIA, template: "amanhã" }]);
    agenda = [item()];
    linked = [importada({ startsAt: new Date("2026-10-20T17:00:00.000Z"), endsAt: new Date("2026-10-20T17:30:00.000Z") })];

    await syncClinicorpAppointments(CONTA, AGORA);

    expect(updatesOf("local-importada")).toEqual([expect.objectContaining({
      data: expect.objectContaining({
        startsAt: INICIO, endsAt: FIM, reminderSentAt: null, clinicorpSeenAt: AGORA,
        // "Falta uma semana" já venceu para o dia 1º: fecha sem enviar.
        remindersSent: { set: [UMA_SEMANA] },
      }),
    })]);
  });

  it("a importada que a clínica desmarcou sai daqui", async () => {
    agenda = [item({ Deleted: "X" })];
    linked = [importada()];

    expect(await syncClinicorpAppointments(CONTA, AGORA)).toMatchObject({ removed: 1 });
    expect(updatesOf("local-importada")).toEqual([{
      where: { id: "local-importada", tenantId: CONTA, status: "scheduled" },
      data: { status: "canceled", clinicorpSeenAt: null },
    }]);
  });

  it("não desfaz o cancelamento que uma pessoa fez aqui", async () => {
    agenda = [item()];
    linked = [importada({ status: "canceled" })];

    await syncClinicorpAppointments(CONTA, AGORA);

    expect(updatesOf("local-importada")).toEqual([]);
  });

  it("traz de volta a importada que a própria importação tinha tirado", async () => {
    agenda = [item()];
    linked = [importada({ status: "canceled", clinicorpSeenAt: null })];

    await syncClinicorpAppointments(CONTA, AGORA);

    expect(updatesOf("local-importada")).toEqual([expect.objectContaining({
      data: expect.objectContaining({ status: "scheduled", clinicorpSeenAt: AGORA }),
    })]);
  });

  it("confirma a importada sem mudança numa escrita só", async () => {
    agenda = [item()];
    linked = [importada()];

    await syncClinicorpAppointments(CONTA, AGORA);

    expect(db.appointment.updateMany).toHaveBeenCalledWith({
      where: { tenantId: CONTA, id: { in: ["local-importada"] } }, data: { clinicorpSeenAt: AGORA },
    });
  });
});

describe("o que sumiu do Clinicorp", () => {
  it("sai daqui depois de uma hora sem aparecer numa lista inteira", async () => {
    agenda = [item()];

    await syncClinicorpAppointments(CONTA, AGORA);

    expect(absenceCall()).toEqual({
      where: expect.objectContaining({
        tenantId: CONTA, source: "clinicorp", status: "scheduled",
        clinicorpSeenAt: { lt: new Date(AGORA.getTime() - 60 * 60_000) },
        clinicorpAppointmentId: { notIn: [ID] },
      }),
      data: { status: "canceled", clinicorpSeenAt: null },
    });
  });

  it("com um item sem id legível, não tira nada — pode ser justamente ele", async () => {
    agenda = [item(), { ItemType: "APPOINTMENT", id: "abc", fromTime: "10:00", toTime: "10:30" }];
    await syncClinicorpAppointments(CONTA, AGORA);
    expect(absenceCall()).toBeUndefined();
  });
});

describe("lembretes que já tinham vencido quando a consulta chegou", () => {
  it("fecha sem enviar o que venceu antes, e deixa sair o que venceu no atraso da varredura", async () => {
    lembretes([{ minutesBefore: UM_DIA, template: "amanhã" }]);
    agenda = [
      // Amanhã 08:00: o "1 dia antes" venceu hoje 08:00, uma hora atrás.
      item({ id: 1, AtomicDate: 20260929, fromTime: "08:00", toTime: "08:30" }),
      // Amanhã 08:50: venceu há 10 minutos, dentro da tolerância.
      item({ id: 2, AtomicDate: 20260929, fromTime: "08:50", toTime: "09:20" }),
    ];

    await syncClinicorpAppointments(CONTA, AGORA);

    const sent = Object.fromEntries(db.appointment.create.mock.calls.map(([args]) => [args.data.clinicorpAppointmentId, args.data.remindersSent]));
    expect(sent).toEqual({ "1": [UM_DIA], "2": [] });
  });
});

describe("falhas e interruptores", () => {
  it("falha da API não grava nada e avisa no card, sem o corpo da resposta", async () => {
    fetchMock.mockResolvedValue(json({ error: "Paciente Maria Souza, CPF 123" }, 500));

    expect(await syncClinicorpAppointments(CONTA, AGORA)).toMatchObject({ status: "failed" });

    expect(db.appointment.create).not.toHaveBeenCalled();
    expect(db.appointment.updateMany).not.toHaveBeenCalled();
    const [{ data }] = db.clinicorpIntegration.update.mock.calls.at(-1)!;
    expect(data).toEqual({ lastImportError: expect.stringContaining("HTTP 500") });
    expect(data.lastImportError).not.toContain("Maria");
  });

  it("resposta que não é lista conta como falha, não como agenda vazia", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 200 }));
    expect(await syncClinicorpAppointments(CONTA, AGORA)).toMatchObject({ status: "failed" });
    expect(absenceCall()).toBeUndefined();
  });

  it.each([
    ["importação desligada", () => { integration.importAppointments = false; }],
    ["Clinicorp desabilitado em Integrações", () => { db.calendarFeatures.findUnique.mockResolvedValue({ clinicorpEnabled: false }); }],
  ])("%s não chama a API", async (_, setup) => {
    setup();
    expect(await syncClinicorpAppointments(CONTA, AGORA)).toEqual({ status: "skipped" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uma conta que falha não para as outras", async () => {
    db.clinicorpIntegration.findMany.mockResolvedValue([{ tenantId: "quebrada" }, { tenantId: CONTA }]);
    db.agent.findFirst.mockImplementation(async ({ where }) => {
      if (where.tenantId === "quebrada") throw new Error("banco fora");
      return null;
    });
    agenda = [item()];

    const total = await importClinicorpAppointments(AGORA);

    expect(total).toMatchObject({ accounts: 2, created: 1, failed: 1 });
    expect(db.clinicorpIntegration.update).toHaveBeenCalledWith({
      where: { tenantId: "quebrada" }, data: { lastImportError: expect.any(String) },
    });
  });
});

describe("telefone do Clinicorp", () => {
  it.each([
    ["(47) 98870-0805", "5547988700805"],
    ["+55 47 98870-0805", "5547988700805"],
    ["047988700805", "5547988700805"],
    ["(47) 3333-4444", "554733334444"],
    ["123", null],
    ["", null],
    [null, null],
  ])("%s -> %s", (raw, expected) => {
    expect(clinicorpPhoneToWhatsApp(raw)).toBe(expected);
  });
});

describe("contato criado no primeiro lembrete", () => {
  it("reusa o contato gravado com a outra forma do número e liga a consulta a ele", async () => {
    db.lead.findFirst.mockResolvedValue({ phone: "554788700805" });
    conversation.getOrCreateConversation.mockResolvedValue({
      lead: { id: "lead-1", phone: "554788700805", name: "Ana" }, conversation: { id: "conv-1" },
    });

    const contact = await contactForImportedAppointment({
      id: "local-importada", tenantId: CONTA, patientPhone: "5547988700805", patientName: "Ana Lima",
    });

    expect(conversation.getOrCreateConversation).toHaveBeenCalledWith(CONTA, "554788700805", "Ana Lima");
    expect(db.appointment.updateMany).toHaveBeenCalledWith({
      where: { id: "local-importada", tenantId: CONTA, leadId: null },
      data: { leadId: "lead-1", conversationId: "conv-1" },
    });
    expect(contact).toEqual({ phone: "554788700805", name: "Ana", conversationId: "conv-1" });
  });
});

describe("fora das métricas do fechai", () => {
  // Ligar a importação não pode inflar "Agendamentos", IA × humano nem o ROI
  // com a agenda inteira da clínica.
  const read = (relative: string) => readFileSync(path.join(path.resolve(__dirname, ".."), relative), "utf8");

  it("toda consulta de agendamento do relatório exclui as importadas", () => {
    const source = read("src/modules/reports/service.ts");
    const queries = source.match(/prisma\.appointment\.\w+\(/g) ?? [];
    expect(queries.length).toBeGreaterThan(0);
    expect(source.match(/\.\.\.NOT_IMPORTED/g)?.length).toBe(queries.length);
  });

  it("a atribuição de Disparo não conta a importada como consulta criada depois do envio", () => {
    expect(read("src/modules/broadcasts/outcomes.ts")).toContain("...NOT_IMPORTED");
  });
});
