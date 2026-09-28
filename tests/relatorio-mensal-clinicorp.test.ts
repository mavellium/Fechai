import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ clinicorpIntegration: { findUnique: vi.fn() }, calendarFeatures: { findUnique: vi.fn() } }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
import { encryptSecret } from "@/lib/crypto";
import { readClinicorpReport, testClinicorpConnection } from "@/modules/scheduling/clinicorp";
import { calculateMonthlyMetrics } from "@/modules/reports/monthly";
import { roiInput } from "./fixtures/monthly-roi";
const fetchMock = vi.fn();
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("ENCRYPTION_KEY", "teste-de-relatorio-com-chave-de-32-caracteres"); vi.stubGlobal("fetch", fetchMock);
  db.clinicorpIntegration.findUnique.mockResolvedValue({ apiUser: encryptSecret("user"), apiToken: encryptSecret("token"), subscriberId: "subscriber", businessId: "123", dentistId: null });
  db.calendarFeatures.findUnique.mockResolvedValue({ clinicorpEnabled: true });
  fetchMock.mockImplementation(async (url: URL) => url.pathname.endsWith("status_list")
    ? json([{ id: 1, Type: "CONFIRMED", Description: "Confirmado" }, { id: 2, Type: "REALIZADO_TESTE", Description: "Realizado" }])
    : json([{ id: "90071992547409931", StatusId: 2, ItemType: "APPOINTMENT" }]));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("leitura de comparecimento Clinicorp", () => {
  it("usa Basic decifrado, escopo da clínica e datas locais inclusive", async () => {
    const result = await readClinicorpReport("tenant", "2026-09-01", "2026-09-30");
    expect(result.available).toBe(true); expect(result.appointments[0]).toMatchObject({ id: "90071992547409931", statusType: "REALIZADO_TESTE" });
    expect(result.integrationState).toBe("configured");
    const [url, init] = fetchMock.mock.calls.find(([url]) => url.pathname.endsWith("/appointment/list"))!;
    expect(url.searchParams.get("from")).toBe("2026-09-01"); expect(url.searchParams.get("to")).toBe("2026-09-30");
    expect(url.searchParams.get("businessId")).toBe("123"); expect(url.searchParams.get("includeCanceled")).toBe("X");
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from("user:token").toString("base64")}`);
  });
  it("integração desligada não faz chamadas", async () => {
    db.calendarFeatures.findUnique.mockResolvedValue({ clinicorpEnabled: false });
    expect(await readClinicorpReport("tenant", "2026-09-01", "2026-09-30")).toMatchObject({ available: false, integrationState: "disabled" }); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("não associa IDs numéricos arredondados nem respostas malformadas", async () => {
    fetchMock.mockImplementation(async (url: URL) => url.pathname.endsWith("status_list") ? json([]) : json([{ id: 90071992547409930, StatusId: 2 }]));
    expect((await readClinicorpReport("tenant", "2026-09-01", "2026-09-30")).available).toBe(false);
    fetchMock.mockResolvedValue(json({ error: "expired" }));
    expect((await readClinicorpReport("tenant", "2026-09-01", "2026-09-30")).available).toBe(false);
  });
  it("falha de rede nunca lança nem confirma presença", async () => {
    fetchMock.mockRejectedValue(new Error("timeout"));
    const result = await readClinicorpReport("tenant", "2026-09-01", "2026-09-30"); expect(result.available).toBe(false); expect(result.appointments).toEqual([]);
  });
  it("não conta eventos de agenda como avaliações e identifica cancelamento", async () => {
    fetchMock.mockImplementation(async (url: URL) => url.pathname.endsWith("status_list") ? json([{ id: 2, Type: "REALIZADO_TESTE" }]) : json([
      { id: "3", ItemType: "EVENT", StatusId: 2 }, { id: "4", ItemType: "APPOINTMENT", StatusId: 2, Canceled: "X" },
    ]));
    expect((await readClinicorpReport("tenant", "2026-09-01", "2026-09-30")).appointments).toEqual([{ id: "4", statusType: "REALIZADO_TESTE", canceled: true }]);
  });
  it("preserva os status quando o teste de conexão funciona e a agenda recusa acesso", async () => {
    fetchMock.mockImplementation(async (url: URL) => url.pathname.endsWith("/business/list") ? json([{ id: 123, Name: "Clínica fictícia" }])
      : url.pathname.endsWith("status_list") ? json([{ id: 2, Type: "REALIZADO_TESTE", Description: "Realizado" }])
      : new Response("corpo-privado-da-api", { status: 403 }));
    expect(await testClinicorpConnection("tenant")).toMatchObject({ ok: true });
    const result = await readClinicorpReport("tenant", "2026-09-01", "2026-09-30");
    expect(result).toMatchObject({ available: false, integrationState: "configured", appointments: [], statusTypes: [{ type: "REALIZADO_TESTE", description: "Realizado" }] });
    expect(result.error).toContain("agenda do período (HTTP 403)");
    expect(result.error).not.toContain("corpo-privado"); expect(result.error).not.toContain("sem conexão");
    const input = roiInput(); input.appointments[0].clinicorpAppointmentId = "123";
    const metrics = calculateMonthlyMetrics({ ...input, clinicorp: result });
    expect(metrics.attendanceUnknown).toBe(1); expect(metrics.attended.outside).toBe(0); expect(metrics.roiPercent).toBeNull();
  });
  it.each(["malformed", "unsafe-id", "network"])("mantém os status recebidos quando a agenda falha: %s", async (failure) => {
    fetchMock.mockImplementation(async (url: URL) => {
      if (url.pathname.endsWith("status_list")) return json([{ id: 2, Type: "REALIZADO_TESTE" }]);
      if (failure === "network") throw new Error("offline");
      return failure === "malformed" ? json({ unexpected: true }) : json([{ id: 90071992547409930, StatusId: 2 }]);
    });
    expect(await readClinicorpReport("tenant", "2026-09-01", "2026-09-30")).toMatchObject({
      available: false, integrationState: "configured", appointments: [], statusTypes: [{ type: "REALIZADO_TESTE" }],
    });
  });
  it("identifica falha na lista de status sem dizer que a conta está desconectada", async () => {
    fetchMock.mockImplementation(async (url: URL) => url.pathname.endsWith("status_list") ? new Response("segredo", { status: 503 }) : json([]));
    const result = await readClinicorpReport("tenant", "2026-09-01", "2026-09-30");
    expect(result.integrationState).toBe("configured"); expect(result.error).toContain("lista de status no Clinicorp (HTTP 503)"); expect(result.error).not.toContain("segredo");
  });
  it("não associa presenças quando a lista de status está incompleta", async () => {
    fetchMock.mockImplementation(async (url: URL) => url.pathname.endsWith("status_list") ? json([{ id: 2, Type: "REALIZADO_TESTE" }, { id: 3 }]) : json([{ id: "123", StatusId: 2 }]));
    const result = await readClinicorpReport("tenant", "2026-09-01", "2026-09-30");
    expect(result.available).toBe(false); expect(result.appointments).toEqual([]); expect(result.error).toContain("lista de status"); expect(result.statusTypes).toHaveLength(1);
  });
  it("distingue ausência de conexão de falha ao carregar as configurações", async () => {
    db.clinicorpIntegration.findUnique.mockResolvedValue(null);
    expect(await readClinicorpReport("tenant", "2026-09-01", "2026-09-30")).toMatchObject({ integrationState: "not_connected" });
    db.clinicorpIntegration.findUnique.mockRejectedValue(new Error("database unavailable"));
    expect(await readClinicorpReport("tenant", "2026-09-01", "2026-09-30")).toMatchObject({ integrationState: "unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("não consulta outras clínicas quando falta escolher a clínica da conta", async () => {
    db.clinicorpIntegration.findUnique.mockResolvedValue({ apiUser: encryptSecret("user"), apiToken: encryptSecret("token"), subscriberId: "subscriber", businessId: null });
    const result = await readClinicorpReport("tenant", "2026-09-01", "2026-09-30");
    expect(result.integrationState).toBe("configured"); expect(result.error).toContain("Escolha uma clínica"); expect(fetchMock).not.toHaveBeenCalled();
  });
});
