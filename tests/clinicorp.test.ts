import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/crypto";

const db = vi.hoisted(() => ({
  clinicorpIntegration: { findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn() },
  calendarFeatures: { findUnique: vi.fn() },
  appointment: { create: vi.fn(), update: vi.fn() },
  lead: { update: vi.fn(), findUnique: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/modules/scheduling/google", () => ({ pushEventToGoogle: vi.fn(async () => null) }));

import {
  cancelAppointmentInClinicorp, getClinicorpStatus, hasClinicorpConflict,
  listClinicorpCategories, listClinicorpProfessionals, pushAppointmentToClinicorp,
  saveClinicorpCredentials, testClinicorpConnection, verifyClinicorpCredentials,
} from "@/modules/scheduling/clinicorp";
import { createAppointment } from "@/modules/scheduling/repository";

const credentials = { apiUser: "usuario-api-teste", apiToken: "token-api-teste", subscriberId: "assinante-teste" };
const event = {
  title: "Teste", startsAt: new Date("2026-09-14T19:30:00Z"), endsAt: new Date("2026-09-14T19:45:00Z"),
  timeZone: "America/Sao_Paulo", lead: { name: "Paciente de teste", phone: "+55 (11) 99999-0000" },
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
let integration: Record<string, unknown>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ENCRYPTION_KEY", "chave-de-testes-com-mais-de-32-caracteres");
  integration = {
    tenantId: "tenant-1", ...credentials,
    apiUser: encryptSecret(credentials.apiUser), apiToken: encryptSecret(credentials.apiToken),
    businessId: "4791226171916288", dentistId: "222222222222", categoryDescription: "Avaliação",
    syncEnabled: true, checkAvailability: true, lastError: "Erro anterior", lastSyncAt: null,
  };
  db.clinicorpIntegration.findUnique.mockImplementation(async () => integration);
  db.clinicorpIntegration.update.mockResolvedValue({});
  db.clinicorpIntegration.upsert.mockResolvedValue({});
  db.calendarFeatures.findUnique.mockResolvedValue({ clinicorpEnabled: true, googleEnabled: false });
  db.appointment.create.mockResolvedValue({ id: "appointment-local" });
  db.appointment.update.mockResolvedValue({});
  db.lead.update.mockResolvedValue({});
  db.lead.findUnique.mockResolvedValue(event.lead);
  fetchMock = vi.fn(async (url: URL) => {
    if (url.pathname.endsWith("/list_categories")) return json([{ id: 1234567890125, Description: "Avaliação" }]);
    if (url.pathname.endsWith("/patient/get")) return json({ PatientId: 333333333333, Status: "ACTIVE" });
    if (url.pathname.endsWith("/business/list")) return json([{ id: 4791226171916288, Name: "Clínica teste" }]);
    return json([{ Status: "CREATED", id: 987654321 }]);
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("envio de agendamentos ao Clinicorp", () => {
  it("envia segunda dia 14 às 16:30 por 15 minutos, ao profissional e à categoria cadastrados", async () => {
    expect(await pushAppointmentToClinicorp("tenant-1", event)).toEqual({ status: "synced", appointmentId: "987654321" });
    const [url, init] = fetchMock.mock.calls.find(([url]) => url.pathname.endsWith("/create_appointment_by_api"))! as unknown as [URL, RequestInit];
    expect(url.searchParams.get("subscriber_id")).toBe(credentials.subscriberId);
    expect(init.headers).toMatchObject({ Authorization: `Basic ${Buffer.from(`${credentials.apiUser}:${credentials.apiToken}`).toString("base64")}` });
    expect(JSON.parse(String(init.body))).toMatchObject({
      Clinic_BusinessId: 4791226171916288, Dentist_PersonId: 222222222222,
      Patient_PersonId: 333333333333, CategoryId: 1234567890125,
      date: "2026-09-14T00:00:00.000Z", fromTime: "16:30", toTime: "16:45", MobilePhone: "5511999990000",
    });
    expect(db.clinicorpIntegration.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ lastError: null, lastSyncAt: expect.any(Date) }) }));
  });

  it.each([null, [], {}, [{ Status: "CREATED" }], [{ Status: "ERROR", id: 7 }], { error: "recusado" }])("não registra sucesso para resposta 200 sem criação válida: %j", async (body) => {
    integration.categoryDescription = null;
    fetchMock.mockImplementation(async (url: URL) => url.pathname.endsWith("/patient/get") ? json({ PatientId: 33 }) : json(body));
    expect(await pushAppointmentToClinicorp("tenant-1", event)).toMatchObject({ status: "failed" });
    expect(db.clinicorpIntegration.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ lastError: expect.any(String), lastErrorAt: expect.any(Date) }) }));
  });

  it.each([401, 403, 500])("preserva a agenda local quando o Clinicorp responde %i", async (status) => {
    fetchMock.mockResolvedValue(json({ error: "Falha" }, status));
    const result = await createAppointment({ tenantId: "tenant-1", leadId: "lead-1", title: event.title,
      startsAt: event.startsAt, durationMinutes: 15, source: "manual", timezone: event.timeZone });
    expect(result).toMatchObject({ id: "appointment-local", clinicorpAppointmentId: null, clinicorpSync: { status: "failed" } });
    expect(db.appointment.create).toHaveBeenCalledOnce();
    expect(db.appointment.update).not.toHaveBeenCalled();
  });

  it("não lança com timeout e não informa sincronização bem-sucedida", async () => {
    fetchMock.mockRejectedValue(new DOMException("timeout", "TimeoutError"));
    expect(await pushAppointmentToClinicorp("tenant-1", event)).toMatchObject({ status: "failed", error: "O Clinicorp não respondeu a tempo." });
  });

  it("não envia sem contato", async () => {
    expect(await pushAppointmentToClinicorp("tenant-1", { ...event, lead: null })).toMatchObject({ status: "failed" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([{ rows: [] }, { rows: [{ id: 1, Description: "Avaliação" }, { id: 2, Description: "Avaliação" }] }])("não escolhe categoria ausente ou ambígua: %j", async ({ rows }) => {
    fetchMock.mockResolvedValue(json(rows));
    expect(await pushAppointmentToClinicorp("tenant-1", event)).toMatchObject({ status: "failed" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("desligar impede envio, mas permite cancelar o agendamento anterior", async () => {
    db.calendarFeatures.findUnique.mockResolvedValue({ clinicorpEnabled: false });
    expect(await pushAppointmentToClinicorp("tenant-1", event)).toEqual({ status: "skipped" });
    expect(fetchMock).not.toHaveBeenCalled();
    await cancelAppointmentInClinicorp("tenant-1", "987654321");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0].pathname).toContain("cancel_appointment");
  });

  it("salva o identificador confirmado junto ao agendamento local", async () => {
    const result = await createAppointment({ tenantId: "tenant-1", leadId: "lead-1", title: event.title,
      startsAt: event.startsAt, durationMinutes: 15, source: "manual", timezone: event.timeZone });
    expect(result.clinicorpAppointmentId).toBe("987654321");
    expect(db.appointment.update).toHaveBeenCalledWith({ where: { id: "appointment-local" }, data: { clinicorpAppointmentId: "987654321" } });
  });
});

describe("conexão e preferências", () => {
  it.each([null, [], { error: "Token inválido" }])("não considera conexão válida apenas por receber HTTP 200: %j", async (body) => {
    fetchMock.mockResolvedValue(json(body));
    expect(await verifyClinicorpCredentials(credentials)).toMatchObject({ ok: false });
  });

  it("expõe erro ao carregar profissionais, permitindo tentar novamente sem limpar o escolhido", async () => {
    fetchMock.mockResolvedValue(json({}, 401));
    expect(await listClinicorpProfessionals("tenant-1")).toMatchObject({ ok: false, error: expect.any(String) });
    expect(db.clinicorpIntegration.update).not.toHaveBeenCalled();
  });

  it("mapeia os campos oficiais de categorias", async () => {
    expect(await listClinicorpCategories("tenant-1")).toEqual({ ok: true, data: [{ id: "1234567890125", name: "Avaliação" }] });
  });

  it("testa acesso sem criar dados nem apagar falha anterior de envio", async () => {
    expect(await testClinicorpConnection("tenant-1")).toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(db.clinicorpIntegration.update).not.toHaveBeenCalled();
  });

  it("não exibe credenciais ilegíveis como conexão ativa nem expõe os segredos na UI", async () => {
    const status = await getClinicorpStatus("tenant-1");
    expect(status).not.toHaveProperty("apiUser");
    expect(status).not.toHaveProperty("apiToken");
    integration.apiToken = "cifra-corrompida";
    expect(await getClinicorpStatus("tenant-1")).toBeNull();
  });

  it("renova credenciais sem sobrescrever o profissional ou a categoria", async () => {
    await saveClinicorpCredentials("tenant-1", credentials);
    const { update } = db.clinicorpIntegration.upsert.mock.calls[0][0];
    expect(update).not.toHaveProperty("dentistId");
    expect(update).not.toHaveProperty("categoryDescription");
    expect(update.apiToken).not.toBe(credentials.apiToken);
  });
});

describe("disponibilidade", () => {
  it("consulta o profissional escolhido, permite horários encostados e bloqueia sobreposição", async () => {
    fetchMock.mockResolvedValue(json([
      { Dentist_PersonId: 999, fromTime: "16:30", toTime: "17:00" },
      { Dentist_PersonId: 222222222222, fromTime: "16:15", toTime: "16:30" },
    ]));
    expect(await hasClinicorpConflict("tenant-1", event.startsAt, event.endsAt, event.timeZone)).toBe(false);
    fetchMock.mockResolvedValue(json([{ Dentist_PersonId: 222222222222, fromTime: "16:40", toTime: "17:00" }]));
    expect(await hasClinicorpConflict("tenant-1", event.startsAt, event.endsAt, event.timeZone)).toBe(true);
  });
});
