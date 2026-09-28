import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ clinicorpIntegration: { findUnique: vi.fn() }, calendarFeatures: { findUnique: vi.fn() } }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
import { encryptSecret } from "@/lib/crypto";
import { readClinicorpReport } from "@/modules/scheduling/clinicorp";
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
    const [url, init] = fetchMock.mock.calls.find(([url]) => url.pathname.endsWith("/appointment/list"))!;
    expect(url.searchParams.get("from")).toBe("2026-09-01"); expect(url.searchParams.get("to")).toBe("2026-09-30");
    expect(url.searchParams.get("businessId")).toBe("123"); expect(url.searchParams.get("includeCanceled")).toBe("X");
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from("user:token").toString("base64")}`);
  });
  it("integração desligada não faz chamadas", async () => {
    db.calendarFeatures.findUnique.mockResolvedValue({ clinicorpEnabled: false });
    expect((await readClinicorpReport("tenant", "2026-09-01", "2026-09-30")).available).toBe(false); expect(fetchMock).not.toHaveBeenCalled();
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
});
