import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ db: {
  bitrixIntegration: { findUnique: vi.fn(), upsert: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn() },
  bitrixSyncJob: { findFirst: vi.fn(), groupBy: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
}, verify: vi.fn(), client: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.db }));
vi.mock("@/modules/bitrix/client", async (original) => ({ ...await original<typeof import("@/modules/bitrix/client")>(), verifyBitrix: mocks.verify, createBitrixClient: mocks.client }));
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { disconnectBitrix, getBitrixStatus, retryBitrix, saveBitrix, workerClient, resolveUncertainBitrix } from "@/modules/bitrix/integration";
const url = "https://contrato.bitrix24.com.br/rest/1/testsecret123/";
const options = { webhook: url, syncLeads: true, syncAppointments: true, responsibleId: "" };
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("ENCRYPTION_KEY", "bitrix-test-only-encryption-key-0123456789");
  mocks.verify.mockResolvedValue(1); mocks.db.bitrixIntegration.findUnique.mockResolvedValue(null); mocks.db.bitrixSyncJob.updateMany.mockResolvedValue({ count: 1 });
});
afterEach(() => vi.unstubAllEnvs());
describe("Bitrix24: conexão por tenant", () => {
  it("valida, cifra e grava somente no tenant solicitado", async () => {
    await saveBitrix("tenant-a", options);
    const input = mocks.db.bitrixIntegration.upsert.mock.calls[0][0];
    expect(input.where).toEqual({ tenantId: "tenant-a" }); expect(input.create.tenantId).toBe("tenant-a");
    expect(input.create.webhook).not.toContain("testsecret123"); expect(decryptSecret(input.create.webhook)).toBe(url);
    expect(input.create.responsibleId).toBe("1"); expect(input.create.syncAppointments).toBe(true);
    expect(mocks.verify).toHaveBeenCalledWith(url, true);
  });
  it("não altera conexão quando a verificação falha", async () => {
    mocks.verify.mockRejectedValue(new Error("API"));
    await expect(saveBitrix("tenant-a", options)).rejects.toThrow();
    expect(mocks.db.bitrixIntegration.upsert).not.toHaveBeenCalled();
  });
  it("renovar webhook no mesmo portal mantém as referências de criação", async () => {
    mocks.db.bitrixIntegration.findUnique.mockResolvedValue({ webhook: encryptSecret(url), portalHost: "contrato.bitrix24.com.br", connectionKey: "old-key" });
    await saveBitrix("tenant-a", { ...options, webhook: "" });
    expect(mocks.db.bitrixIntegration.upsert.mock.calls[0][0].update).not.toHaveProperty("connectionKey");
  });
  it("trocar portal exige desconectar; destino novo recebe outra identidade", async () => {
    const old = { webhook: encryptSecret(url), portalHost: "contrato.bitrix24.com.br", connectionKey: "old-key" };
    mocks.db.bitrixIntegration.findUnique.mockResolvedValue(old);
    const newOptions = { ...options, webhook: "https://novo.bitrix24.com.br/rest/1/testsecret123/" };
    await expect(saveBitrix("tenant-a", newOptions)).rejects.toThrow("desconecte");
    expect(mocks.db.bitrixIntegration.upsert).not.toHaveBeenCalled();
    mocks.db.bitrixIntegration.findUnique.mockResolvedValue({ ...old, webhook: null });
    await saveBitrix("tenant-a", newOptions);
    expect(mocks.db.bitrixIntegration.upsert.mock.calls[0][0].update.connectionKey).not.toBe("old-key");
  });
  it("status enviado à interface não contém nenhuma credencial ou texto de conversa", async () => {
    mocks.db.bitrixIntegration.findUnique.mockResolvedValue({ webhook: encryptSecret(url), portalHost: "contrato.bitrix24.com.br", connectionKey: "key", enabled: true,
      syncLeads: true, syncAppointments: true, crmMode: 1, responsibleId: "1", lastSyncAt: null });
    mocks.db.bitrixSyncJob.groupBy.mockResolvedValue([{ state: "synced", _count: { _all: 5 } }]);
    mocks.db.bitrixSyncJob.findMany.mockResolvedValue([]);
    const result = await getBitrixStatus("tenant-a");
    expect(result).toMatchObject({ connected: true, portalHost: "contrato.bitrix24.com.br", counts: { synced: 5 } });
    expect(JSON.stringify(result)).not.toContain("webhook"); expect(JSON.stringify(result)).not.toContain("testsecret123");
    expect(mocks.db.bitrixSyncJob.groupBy.mock.calls[0][0].where).toEqual({ tenantId: "tenant-a", connectionKey: "key" });
  });
  it("desconectar apaga segredo e pausa sem apagar referências", async () => {
    await disconnectBitrix("tenant-a");
    expect(mocks.db.bitrixIntegration.updateMany).toHaveBeenCalledWith({ where: { tenantId: "tenant-a" }, data: expect.objectContaining({ webhook: null, enabled: false }) });
    expect(mocks.db.bitrixSyncJob.updateMany).not.toHaveBeenCalled();
  });
  it("conferir não remove os marcadores de envio incerto", async () => {
    mocks.db.bitrixIntegration.findUnique.mockResolvedValue({ enabled: true, webhook: encryptSecret(url), connectionKey: "key" });
    await retryBitrix("tenant-a");
    expect(mocks.db.bitrixSyncJob.updateMany).toHaveBeenCalledWith({ where: { tenantId: "tenant-a", connectionKey: "key", state: "retry" }, data: { nextAttemptAt: expect.any(Date) } });
  });
  it("worker ignora conta suspensa, desconectada, portal trocado ou escopo desligado", async () => {
    mocks.db.bitrixIntegration.findFirst.mockResolvedValue(null);
    expect(await workerClient("tenant-a", "old-key", "appointment")).toBeNull();
    expect(mocks.db.bitrixIntegration.findFirst.mock.calls[0][0].where).toMatchObject({ tenantId: "tenant-a", connectionKey: "old-key", enabled: true, tenant: { status: "active" } });
    mocks.db.bitrixIntegration.findFirst.mockResolvedValue({ webhook: encryptSecret(url), revision: "r", syncAppointments: false });
    expect(await workerClient("tenant-a", "key", "appointment")).toBeNull();
    expect(mocks.client).not.toHaveBeenCalled();
  });
});

describe("Bitrix24: resolver criação incerta", () => {
  const api = vi.fn();
  beforeEach(() => {
    const row = { tenantId: "tenant-a", enabled: true, webhook: encryptSecret(url), portalHost: "contrato.bitrix24.com.br", revision: "r", connectionKey: "key", syncAppointments: true };
    mocks.db.bitrixIntegration.findUnique.mockResolvedValue(row);
    mocks.db.bitrixIntegration.findFirst.mockResolvedValue(row);
    mocks.db.bitrixSyncJob.findFirst.mockResolvedValue({ id: "job", tenantId: "tenant-a", connectionKey: "key", entityId: "lead", state: "retry", uncertain: "contact" });
    mocks.db.bitrixSyncJob.updateMany.mockResolvedValue({ count: 1 });
    api.mockReset(); api.mockResolvedValue({ items: [] }); mocks.client.mockReturnValue(api);
  });
  it("registro encontrado recupera ID sem exigir confirmação nem criar outro", async () => {
    api.mockResolvedValue({ items: [{ id: 11 }] });
    expect(await resolveUncertainBitrix("tenant-a", "job", false)).toContain("Registro encontrado");
    expect(mocks.db.bitrixSyncJob.updateMany.mock.calls[1][0].data).toMatchObject({ contactId: "11", contactManaged: true, uncertain: null, state: "queued" });
    expect(api.mock.calls.some(([method]) => String(method).endsWith(".add"))).toBe(false);
  });
  it("busca vazia mantém a proteção sem confirmação humana", async () => {
    await expect(resolveUncertainBitrix("tenant-a", "job", false)).rejects.toThrow("Confira o portal");
    expect(mocks.db.bitrixSyncJob.updateMany.mock.calls.some(([input]) => input.data.uncertain === null)).toBe(false);
  });
  it("só libera após confirmação e leitura vazia; concede tempo para um commit tardio", async () => {
    expect(await resolveUncertainBitrix("tenant-a", "job", true)).toContain("Nova tentativa permitida");
    const data = mocks.db.bitrixSyncJob.updateMany.mock.calls[1][0].data;
    expect(data).toMatchObject({ uncertain: null, state: "queued" });
    expect(data.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 290_000);
    expect(api).toHaveBeenCalledWith("crm.item.list", expect.objectContaining({ entityTypeId: 3 }));
  });
  it("registro de outro tenant ou outra conexão não pode ser liberado", async () => {
    mocks.db.bitrixSyncJob.findFirst.mockResolvedValue(null);
    await expect(resolveUncertainBitrix("tenant-a", "job", true)).rejects.toThrow("outra conexão");
    expect(api).not.toHaveBeenCalled();
    expect(mocks.db.bitrixSyncJob.findFirst.mock.calls[0][0].where).toMatchObject({ tenantId: "tenant-a", connectionKey: "key", id: "job" });
  });
  it("claim ocupado não permite resolver e duplicados não permitem recriar", async () => {
    mocks.db.bitrixSyncJob.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(resolveUncertainBitrix("tenant-a", "job", true)).rejects.toThrow("sendo conferido");
    api.mockResolvedValue({ items: [{ id: 11 }, { id: 12 }] });
    await expect(resolveUncertainBitrix("tenant-a", "job", true)).rejects.toThrow("duplicados");
  });
});
