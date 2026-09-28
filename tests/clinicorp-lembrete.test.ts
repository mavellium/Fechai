import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Lembretes das consultas marcadas direto no Clinicorp.
 *
 * Pedido da clínica: essas pessoas também precisam ser lembradas — mas o
 * primeiro contato só pela API oficial da Meta, nunca pelo Evolution, por causa
 * do risco de bloqueio do número.
 */

const db = vi.hoisted(() => ({
  tenantAction: { findMany: vi.fn() },
  agent: { findMany: vi.fn() },
  whatsappInstance: { findUnique: vi.fn() },
  clinicorpReminder: { deleteMany: vi.fn(), findMany: vi.fn(), upsert: vi.fn() },
  appointment: { findMany: vi.fn() },
  lead: { findFirst: vi.fn() },
  message: { create: vi.fn() },
}));
const clinicorp = vi.hoisted(() => ({ listClinicorpAgenda: vi.fn() }));
const meta = vi.hoisted(() => ({ getBroadcastConnection: vi.fn(), sendBroadcastTemplate: vi.fn() }));
const evolution = vi.hoisted(() => ({ isConfigured: vi.fn(() => true), sendMessage: vi.fn() }));
const blocklist = vi.hoisted(() => ({ isPhoneBlocked: vi.fn() }));
const conversations = vi.hoisted(() => ({ getOrCreateConversation: vi.fn() }));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/modules/scheduling/clinicorp", () => ({ ...clinicorp, CLINICORP_UNNAMED_PATIENT: "Paciente sem nome" }));
vi.mock("@/modules/broadcasts/connection", () => ({ getBroadcastConnection: meta.getBroadcastConnection }));
vi.mock("@/modules/whatsapp/meta-config", () => ({
  WHATSAPP_PROVIDER_SELECT: {},
  getWhatsAppProviderForInstance: () => evolution,
}));
vi.mock("@/modules/whatsapp/blocklist", () => blocklist);
vi.mock("@/modules/agent-engine/conversation", () => conversations);

import { clinicorpWhatsappPhone, scanAndSendClinicorpReminders } from "../workers/follow-up-worker/clinicorp-reminders";
import { parseScheduleConfig } from "@/modules/scheduling/config";
import { validateMetaReminderTemplate, type MetaReminderTemplate } from "@/modules/scheduling/meta-reminder";

const CONTA = "tenant-1";
const AGORA = new Date("2026-09-28T12:00:00.000Z"); // 09:00 em Brasília
const UM_DIA = 24 * 60;
const TEMPLATE = {
  id: "tpl-1", name: "lembrete_consulta", language: "pt_BR",
  body: "Olá {{1}}, sua consulta é {{2}} às {{3}}.", header: "", footer: "",
  parameterCount: 3, variables: ["nome", "data", "hora"],
};
// Amanhã às 08:00 de Brasília: o "1 dia antes" venceu às 08:00 de hoje.
const consulta = (over: Record<string, unknown> = {}) => ({
  id: "4791226171916288", startsAt: new Date("2026-09-29T11:00:00.000Z"), endsAt: null,
  patientName: "Maria Souza", phone: "14991406457", professional: null, notes: null, ...over,
});

let config: Record<string, unknown>;
const provider = (kind: "meta" | "evolution") =>
  db.whatsappInstance.findUnique.mockResolvedValue({ status: "connected", provider: kind, externalId: "inst-1" });
const upserts = () => db.clinicorpReminder.upsert.mock.calls.map(([arg]) => arg);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  config = {
    timezone: "America/Sao_Paulo",
    reminderEnabled: true,
    reminders: [{ minutesBefore: UM_DIA, template: "Oi {{nome}}! Sua consulta é {{data}} às {{hora}}." }],
    metaReminderTemplate: TEMPLATE,
  };
  db.tenantAction.findMany.mockImplementation(async () => [{ tenantId: CONTA, agentId: "agente-1", config }]);
  db.agent.findMany.mockResolvedValue([{ id: "agente-1", tenantId: CONTA }]);
  db.clinicorpReminder.deleteMany.mockResolvedValue({ count: 0 });
  db.clinicorpReminder.findMany.mockResolvedValue([]);
  db.clinicorpReminder.upsert.mockResolvedValue({});
  db.appointment.findMany.mockResolvedValue([]);
  db.lead.findFirst.mockResolvedValue(null);
  db.message.create.mockResolvedValue({});
  clinicorp.listClinicorpAgenda.mockResolvedValue({ status: "ok", items: [consulta()], skipped: 0 });
  meta.getBroadcastConnection.mockResolvedValue({ provider: { sendBroadcastTemplate: meta.sendBroadcastTemplate } });
  meta.sendBroadcastTemplate.mockResolvedValue("wamid-1");
  evolution.sendMessage.mockResolvedValue("key-1");
  blocklist.isPhoneBlocked.mockResolvedValue(false);
  conversations.getOrCreateConversation.mockResolvedValue({ lead: {}, conversation: { id: "conversa-nova" } });
  provider("meta");
});

describe("template da Meta na config", () => {
  it("guarda o template válido e descarta o incompleto, sem quebrar a config antiga", () => {
    expect(parseScheduleConfig({ metaReminderTemplate: TEMPLATE }).metaReminderTemplate).toMatchObject({ name: "lembrete_consulta" });
    // Uma variável para dois `{{n}}`: a Meta recusaria cada envio.
    expect(parseScheduleConfig({ metaReminderTemplate: { ...TEMPLATE, variables: ["nome"] } })).not.toHaveProperty("metaReminderTemplate");
    expect(parseScheduleConfig({ metaReminderTemplate: { ...TEMPLATE, variables: ["nome", "data", "medico"] } })).not.toHaveProperty("metaReminderTemplate");
    expect(parseScheduleConfig({})).not.toHaveProperty("metaReminderTemplate");
  });

  it("recusa {{local}} com o local da consulta em branco", () => {
    const template = { ...TEMPLATE, variables: ["nome", "data", "local"] } as MetaReminderTemplate;
    expect(validateMetaReminderTemplate(template, { location: "" })).toMatch(/Local ou formato/);
    expect(validateMetaReminderTemplate(template, { location: "no consultório" })).toBeNull();
  });
});

describe("telefone do Clinicorp", () => {
  it.each([
    ["14991406457", "5514991406457"],
    ["+55 (14) 98187-2315", "5514981872315"],
    ["5514981792434", "5514981792434"],
    ["014 99140-6457", "5514991406457"],
    ["1433221100", "551433221100"],
  ])("%s vira %s", (raw, phone) => expect(clinicorpWhatsappPhone(raw)).toBe(phone));

  it.each([null, "", "123", "abc"])("recusa %j", (raw) => expect(clinicorpWhatsappPhone(raw)).toBeNull());
});

describe("pela Meta", () => {
  it("manda o template a quem nunca conversou e grava na conversa", async () => {
    const result = await scanAndSendClinicorpReminders(AGORA);

    expect(result).toMatchObject({ sent: 1 });
    const [phone, template, params] = meta.sendBroadcastTemplate.mock.calls[0];
    expect(phone).toBe("5514991406457");
    expect(template).toMatchObject({ name: "lembrete_consulta" });
    expect(params[0]).toBe("Maria Souza");
    expect(params[2]).toBe("08:00");
    expect(conversations.getOrCreateConversation).toHaveBeenCalledWith(CONTA, "5514991406457", "Maria Souza");
    expect(db.message.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      conversationId: "conversa-nova", role: "assistant", whatsappMessageId: "wamid-1",
      content: expect.stringContaining("Olá Maria Souza"),
    }) });
    expect(upserts()[0]).toMatchObject({ create: { remindersSent: [UM_DIA], reminderSentAt: AGORA } });
    // Relê o Clinicorp de verdade, do dia de hoje em diante.
    expect(clinicorp.listClinicorpAgenda).toHaveBeenCalledWith(CONTA, "2026-09-28", expect.any(String), "America/Sao_Paulo", { fresh: true });
  });

  it("sem template escolhido, não manda nada e nem lê o Clinicorp", async () => {
    delete config.metaReminderTemplate;
    await scanAndSendClinicorpReminders(AGORA);
    expect(clinicorp.listClinicorpAgenda).not.toHaveBeenCalled();
    expect(meta.sendBroadcastTemplate).not.toHaveBeenCalled();
  });

  it("não reenvia quando a Meta não confirma: pode ter aceitado", async () => {
    meta.sendBroadcastTemplate.mockRejectedValue(new Error("A Meta não confirmou o resultado do envio."));
    await scanAndSendClinicorpReminders(AGORA);
    expect(upserts()[0]).toMatchObject({ create: { remindersSent: [UM_DIA], reminderSentAt: null } });
    expect(db.message.create).not.toHaveBeenCalled();
  });

  it("paciente sem nome no Clinicorp não recebe template com o nome em branco", async () => {
    clinicorp.listClinicorpAgenda.mockResolvedValue({ status: "ok", items: [consulta({ patientName: "Paciente sem nome" })], skipped: 0 });
    await scanAndSendClinicorpReminders(AGORA);
    expect(meta.sendBroadcastTemplate).not.toHaveBeenCalled();
    expect(upserts()[0]).toMatchObject({ create: { remindersSent: [UM_DIA], reminderSentAt: null } });
  });
});

describe("pelo Evolution", () => {
  beforeEach(() => provider("evolution"));

  it("primeiro contato nunca sai, e o disparo fica pendente", async () => {
    const result = await scanAndSendClinicorpReminders(AGORA);
    expect(result).toMatchObject({ sent: 0, firstContactSkipped: 1 });
    expect(evolution.sendMessage).not.toHaveBeenCalled();
    expect(meta.sendBroadcastTemplate).not.toHaveBeenCalled();
    // Não fecha: se a pessoa escrever antes da consulta, o lembrete ainda sai.
    expect(db.clinicorpReminder.upsert).not.toHaveBeenCalled();
  });

  it("quem já conversou recebe o texto do lembrete, na conversa que já existe", async () => {
    db.lead.findFirst.mockResolvedValue({
      phone: "5514991406457",
      conversation: { id: "conversa-1", lastInboundAt: new Date("2026-09-01T12:00:00Z"), followUpReason: null, variables: null },
    });
    await scanAndSendClinicorpReminders(AGORA);
    const [instance, phone, text] = evolution.sendMessage.mock.calls[0];
    expect([instance, phone]).toEqual(["inst-1", "5514991406457"]);
    expect(text).toMatch(/^Oi Maria Souza! Sua consulta é .* às 08:00\.$/);
    expect(db.message.create).toHaveBeenCalledWith({ data: expect.objectContaining({ conversationId: "conversa-1", role: "assistant" }) });
    expect(upserts()[0]).toMatchObject({ create: { reminderSentAt: AGORA } });
  });
});

describe("regras de envio", () => {
  it("pula a consulta que o próprio fechai espelhou no Clinicorp", async () => {
    db.appointment.findMany.mockResolvedValue([{ clinicorpAppointmentId: "4791226171916288" }]);
    await scanAndSendClinicorpReminders(AGORA);
    expect(meta.sendBroadcastTemplate).not.toHaveBeenCalled();
  });

  it("não repete o que já saiu, mas volta a lembrar se a consulta foi remarcada lá", async () => {
    db.clinicorpReminder.findMany.mockResolvedValue([
      { clinicorpAppointmentId: "4791226171916288", startsAt: consulta().startsAt, remindersSent: [UM_DIA] },
    ]);
    await scanAndSendClinicorpReminders(AGORA);
    expect(meta.sendBroadcastTemplate).not.toHaveBeenCalled();

    db.clinicorpReminder.findMany.mockResolvedValue([
      { clinicorpAppointmentId: "4791226171916288", startsAt: new Date("2026-09-25T11:00:00Z"), remindersSent: [UM_DIA] },
    ]);
    await scanAndSendClinicorpReminders(AGORA);
    expect(meta.sendBroadcastTemplate).toHaveBeenCalledOnce();
    expect(upserts().at(-1)).toMatchObject({ update: { startsAt: consulta().startsAt, remindersSent: { set: [UM_DIA] } } });
  });

  it("ainda não venceu: não manda", async () => {
    clinicorp.listClinicorpAgenda.mockResolvedValue({ status: "ok", items: [consulta({ startsAt: new Date("2026-09-30T11:00:00Z") })], skipped: 0 });
    await scanAndSendClinicorpReminders(AGORA);
    expect(meta.sendBroadcastTemplate).not.toHaveBeenCalled();
  });

  it.each([
    ["número bloqueado", () => blocklist.isPhoneBlocked.mockResolvedValue(true)],
    ["sem telefone", () => clinicorp.listClinicorpAgenda.mockResolvedValue({ status: "ok", items: [consulta({ phone: null })], skipped: 0 })],
    ["pediu para parar", () => db.lead.findFirst.mockResolvedValue({ phone: "5514991406457", conversation: { id: "c", lastInboundAt: null, followUpReason: "stop", variables: null } })],
  ])("%s: fecha sem enviar", async (_, arrange) => {
    arrange();
    await scanAndSendClinicorpReminders(AGORA);
    expect(meta.sendBroadcastTemplate).not.toHaveBeenCalled();
    expect(upserts()[0]).toMatchObject({ create: { reminderSentAt: null } });
  });

  it("lembrete desligado, WhatsApp desconectado ou Clinicorp fora: nada sai", async () => {
    config.reminderEnabled = false;
    await scanAndSendClinicorpReminders(AGORA);
    config.reminderEnabled = true;
    db.whatsappInstance.findUnique.mockResolvedValue({ status: "disconnected", provider: "meta", externalId: "inst-1" });
    await scanAndSendClinicorpReminders(AGORA);
    provider("meta");
    clinicorp.listClinicorpAgenda.mockResolvedValue({ status: "error", error: "fora" });
    await scanAndSendClinicorpReminders(AGORA);
    expect(meta.sendBroadcastTemplate).not.toHaveBeenCalled();
    expect(db.clinicorpReminder.upsert).not.toHaveBeenCalled();
  });
});
