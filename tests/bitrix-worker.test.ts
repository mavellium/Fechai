import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BitrixIntegration, BitrixSyncJob } from "@prisma/client";
const mock = vi.hoisted(() => ({ db: {
  bitrixSyncJob: { findFirst: vi.fn(), updateMany: vi.fn(), upsert: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
  bitrixIntegration: { updateMany: vi.fn(), findMany: vi.fn() }, lead: { findFirst: vi.fn(), findMany: vi.fn() }, appointment: { findFirst: vi.fn(), findMany: vi.fn() },
}, client: vi.fn(), mirror: vi.fn(), appointment: vi.fn(), call: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: mock.db }));
vi.mock("@/modules/bitrix/integration", () => ({ workerClient: mock.client }));
vi.mock("@/modules/bitrix/mirror", async (original) => ({ ...await original<typeof import("@/modules/bitrix/mirror")>(), mirrorLead: mock.mirror, mirrorAppointment: mock.appointment }));
import { captureBitrix, enqueueBitrix, processBitrixJob } from "@/modules/bitrix/worker";
import { fingerprint, type MirrorContext } from "@/modules/bitrix/mirror";
import { BitrixFailure } from "@/modules/bitrix/client";
const now = new Date("2026-10-08T16:00:00Z");
const payload = { id: "lead-a", name: "Teste", phone: "5511999991111", status: "new" };
const row: BitrixIntegration = { tenantId: "tenant-a", connectionKey: "key-a", revision: "r-a", webhook: "encrypted", portalHost: "portal.bitrix24.com", enabled: true,
  syncLeads: true, syncAppointments: true, crmMode: 1, responsibleId: "1", connectedAt: now, leadCursor: new Date(0), leadAfter: "", appointmentCursor: new Date(0), appointmentAfter: "", lastSyncAt: null, createdAt: now, updatedAt: now };
let job: BitrixSyncJob;
let versionChanged: boolean;
beforeEach(() => {
  vi.resetAllMocks(); versionChanged = false;
  job = { id: "job-a", tenantId: "tenant-a", connectionKey: "key-a", kind: "lead", entityId: "lead-a", payload,
    fingerprint: fingerprint({ payload, syncLeads: true, syncAppointments: true, responsibleId: "1" }), state: "queued", attempts: 0,
    nextAttemptAt: now, lockedUntil: null, lockToken: null, lastError: null, contactId: null, contactManaged: false, crmId: null, crmEntityType: null, activityId: null, uncertain: null, createdAt: now, updatedAt: now };
  mock.db.bitrixSyncJob.findFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => where.tenantId === job.tenantId && where.id === job.id ? { ...job } : null);
  mock.db.bitrixSyncJob.updateMany.mockImplementation(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    if (where.tenantId !== job.tenantId || where.id !== job.id) return { count: 0 };
    if (where.lockToken && where.lockToken !== job.lockToken) return { count: 0 };
    if (typeof where.fingerprint === "string" && where.fingerprint !== job.fingerprint) return { count: 0 };
    if (where.state && job.lockedUntil && job.lockedUntil > now) return { count: 0 };
    Object.assign(job, data, { attempts: typeof data.attempts === "object" ? job.attempts + 1 : job.attempts });
    return { count: 1 };
  });
  mock.client.mockResolvedValue({ row, call: mock.call }); mock.call.mockResolvedValue({});
  mock.db.lead.findFirst.mockResolvedValue({ ...payload, tenantId: "tenant-a", isTest: false });
  mock.db.lead.findMany.mockResolvedValue([]); mock.db.appointment.findMany.mockResolvedValue([]);
  mock.db.bitrixSyncJob.upsert.mockResolvedValue({ id: job.id });
  mock.mirror.mockImplementation(async (ctx: MirrorContext) => {
    await ctx.persist({ contactId: "11", uncertain: null });
    if (versionChanged) { job.fingerprint = "newer-source"; job.state = "queued"; }
  });
});
describe("Bitrix24: fila durável", () => {
  it("claim acontece antes de enviar e IDs externos são persistidos", async () => {
    mock.mirror.mockImplementation(async (ctx: MirrorContext) => {
      expect(job.state).toBe("processing"); expect(job.lockToken).toBeTruthy();
      await ctx.persist({ contactId: "11", crmId: "22" });
    });
    await processBitrixJob("job-a", "tenant-a", now);
    expect(job).toMatchObject({ contactId: "11", crmId: "22", state: "synced", lockToken: null });
    expect(mock.db.lead.findFirst).toHaveBeenCalledWith({ where: { id: "lead-a", tenantId: "tenant-a", isTest: false } });
  });
  it("claims simultâneos resultam em um envio só", async () => {
    await Promise.all([processBitrixJob("job-a", "tenant-a", now), processBitrixJob("job-a", "tenant-a", now)]);
    expect(mock.mirror).toHaveBeenCalledOnce();
  });
  it("não permite processar ID de job de outro tenant", async () => {
    await processBitrixJob("job-a", "tenant-b", now);
    expect(mock.client).not.toHaveBeenCalled(); expect(mock.mirror).not.toHaveBeenCalled();
  });
  it("conexão inativa ou portal diferente deixa a fila intocada", async () => {
    mock.client.mockResolvedValue(null);
    await processBitrixJob("job-a", "tenant-a", now);
    expect(mock.db.bitrixSyncJob.updateMany).not.toHaveBeenCalled(); expect(mock.mirror).not.toHaveBeenCalled();
  });
  it("mudança durante POST preserva versão nova e ID confirmado, sem reconhecer payload antigo", async () => {
    versionChanged = true;
    await processBitrixJob("job-a", "tenant-a", now);
    expect(job).toMatchObject({ contactId: "11", state: "queued", fingerprint: "newer-source", lockToken: null });
    expect(mock.db.bitrixIntegration.updateMany).not.toHaveBeenCalled();
  });
  it("falha temporária retém a referência, mostra erro seguro e agenda nova conferência", async () => {
    mock.mirror.mockImplementation(async (ctx: MirrorContext) => { await ctx.persist({ uncertain: "contact" }); throw new BitrixFailure("Vamos conferir o registro.", true, 120_000); });
    await processBitrixJob("job-a", "tenant-a", now);
    expect(job).toMatchObject({ state: "retry", uncertain: "contact", lastError: "Vamos conferir o registro.", lockToken: null });
    expect(job.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 110_000);
  });
  it("claim expirado após reinício pode ser retomado", async () => {
    job.state = "processing"; job.lockedUntil = new Date(now.getTime() - 1); job.lockToken = "crashed";
    await processBitrixJob("job-a", "tenant-a", now);
    expect(mock.mirror).toHaveBeenCalledOnce(); expect(job.state).toBe("synced");
  });
  it("contatos excluídos ou de teste ficam sem envio", async () => {
    mock.db.lead.findFirst.mockResolvedValue(null);
    await processBitrixJob("job-a", "tenant-a", now);
    expect(mock.mirror).not.toHaveBeenCalled(); expect(job.state).toBe("skipped");
  });
  it("não expõe stack nem URL recebida em exceção inesperada", async () => {
    mock.mirror.mockRejectedValue(new Error("https://portal.bitrix24.com/rest/1/secretkey123/"));
    await processBitrixJob("job-a", "tenant-a", now);
    expect(job.lastError).not.toContain("secretkey123"); expect(job.state).toBe("retry");
  });
  it("re-enfileirar alteração preserva IDs, incerteza e claim", async () => {
    await enqueueBitrix(row, "lead", "lead-a", { ...payload, name: "Outro nome" });
    const input = mock.db.bitrixSyncJob.updateMany.mock.calls[0][0];
    expect(input.where).toMatchObject({ id: "job-a", tenantId: "tenant-a", fingerprint: { not: expect.any(String) } });
    for (const field of ["contactId", "crmId", "uncertain", "lockToken", "lockedUntil"]) expect(input.data).not.toHaveProperty(field);
    expect(mock.db.bitrixSyncJob.upsert.mock.calls[0][0].where).toEqual({ tenantId_connectionKey_kind_entityId: { tenantId: "tenant-a", connectionKey: "key-a", kind: "lead", entityId: "lead-a" } });
  });
  it("captura incremental exclui testes, filtra tenant e só avança cursor da mesma configuração", async () => {
    await captureBitrix(row, now);
    expect(mock.db.lead.findMany.mock.calls[0][0].where).toMatchObject({ tenantId: "tenant-a", isTest: false, updatedAt: { lte: new Date(now.getTime() - 2000) } });
    expect(mock.db.appointment.findMany.mock.calls[0][0].where).toMatchObject({ tenantId: "tenant-a" });
    expect(mock.db.bitrixIntegration.updateMany).toHaveBeenCalledWith({ where: { tenantId: "tenant-a", connectionKey: "key-a", revision: "r-a" }, data: expect.objectContaining({ leadAfter: "", appointmentAfter: "" }) });
  });
  it("cursor usa ID para não perder linhas com o mesmo instante", async () => {
    await captureBitrix({ ...row, leadCursor: now, leadAfter: "lead-old" }, new Date(now.getTime() + 5000));
    expect(mock.db.lead.findMany.mock.calls[0][0].where.OR).toEqual([{ updatedAt: { gt: now } }, { updatedAt: now, id: { gt: "lead-old" } }]);
  });
});
