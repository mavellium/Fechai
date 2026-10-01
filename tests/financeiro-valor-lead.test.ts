import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(), audit: vi.fn(), revalidate: vi.fn(),
  db: { tenantLeadValue: { create: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
    tenant: { findUnique: vi.fn() }, appointment: { findMany: vi.fn() }, agent: { findMany: vi.fn() },
    lead: { findMany: vi.fn(), count: vi.fn() }, tenantAttendanceCost: { findMany: vi.fn() }, monthlyRoiReport: { updateMany: vi.fn() } },
}));
vi.mock("@/lib/session", () => ({ requireTenant: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.db }));
vi.mock("@/lib/rate-limit", () => ({ payloadTooLarge: () => null }));
vi.mock("@/modules/audit/log", () => ({ recordAudit: mocks.audit }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { saveLeadValue } from "@/app/(dashboard)/relatorios/actions";
import { computeFinancialSummary, resolveRange } from "@/modules/reports/service";

const startsAt = new Date("2026-09-30T12:00:00Z");
let values: { id: string; tenantId: string; valueCents: number; startsAt: Date }[];
const form = (mode = "correct", value = "25,00", id = "v1", before = "1000") => {
  const f = new FormData();
  for (const [key, val] of Object.entries({ mode, value, valueId: id, valueBefore: before, valueStartsAt: startsAt.toISOString() })) f.set(key, val);
  return f;
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
  values = [{ id: "v1", tenantId: "own", valueCents: 1000, startsAt }];
  mocks.auth.mockResolvedValue({ tenantId: "own" });
  mocks.db.tenantLeadValue.findMany.mockImplementation(async ({ where }) => values.filter(v => v.tenantId === where.tenantId).sort((a,b) => a.startsAt.getTime()-b.startsAt.getTime()));
  mocks.db.tenantLeadValue.updateMany.mockImplementation(async ({ where, data }) => {
    const row = values.find(v => v.id === where.id && v.tenantId === where.tenantId && v.valueCents === where.valueCents && +v.startsAt === +where.startsAt);
    if (!row) return { count: 0 };
    row.valueCents = data.valueCents; return { count: 1 };
  });
  mocks.db.tenantLeadValue.create.mockImplementation(async ({ data }) => { const row = { id: "v2", ...data }; values.push(row); return row; });
  mocks.db.tenant.findUnique.mockResolvedValue({ planKey: "FREE", createdAt: new Date("2026-09-01T03:00:00Z"), priceCentsOverride: 15000 });
  mocks.db.appointment.findMany.mockResolvedValue([{ createdAt: new Date("2026-09-15T12:00:00Z"), agentId: "a" }]);
  mocks.db.agent.findMany.mockResolvedValue([{ id: "a", name: "Agente" }]);
  mocks.db.lead.findMany.mockResolvedValue([]); mocks.db.lead.count.mockResolvedValue(0);
  mocks.db.tenantAttendanceCost.findMany.mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());

describe("edição do valor do lead no Financeiro", () => {
  it("corrige os R$ 10 exibidos em setembro e recalcula o retorno preservando a vigência", async () => {
    const range = resolveRange("mes", "2026-09-01", "2026-09-30");
    expect(await computeFinancialSummary("own", range)).toMatchObject({ valueId: "v1", valuePerLeadCents: 1000, returnCents: 1000 });
    expect(await saveLeadValue(null, form())).toMatchObject({ ok: true, info: expect.stringContaining("corrigido") });
    expect(await computeFinancialSummary("own", range)).toMatchObject({ valueId: "v1", valuePerLeadCents: 2500, returnCents: 2500, valueStartsAt: startsAt });
    expect(mocks.db.tenantLeadValue.create).not.toHaveBeenCalled();
    expect(mocks.db.monthlyRoiReport.updateMany).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ before: { valueCents: 1000, startsAt }, after: { valueCents: 2500, startsAt } }));
  });
  it("nova vigência mantém o valor anterior em setembro", async () => {
    expect((await saveLeadValue(null, form("new"))).ok).toBe(true);
    expect(mocks.db.tenantLeadValue.updateMany).not.toHaveBeenCalled();
    expect(await computeFinancialSummary("own", resolveRange("mes", "2026-09-01", "2026-09-30"))).toMatchObject({ valueId: "v1", valuePerLeadCents: 1000 });
    expect(values).toHaveLength(2);
  });
  it.each([["foreign", "1000"], ["v1", "999"]])("recusa id de outra conta ou correção concorrente: %s", async (id, before) => {
    values.push({ id: "foreign", tenantId: "other", valueCents: 1000, startsAt });
    expect((await saveLeadValue(null, form("correct", "25,00", id, before))).ok).toBe(false);
    expect(values.map(v => v.valueCents)).toEqual([1000, 1000]); expect(mocks.audit).not.toHaveBeenCalled(); expect(mocks.revalidate).not.toHaveBeenCalled();
    expect(mocks.db.tenantLeadValue.updateMany.mock.calls[0][0].where.tenantId).toBe("own");
  });
  it("exige sessão antes de alterar o banco", async () => {
    mocks.auth.mockRejectedValue(new Error("Sessão expirada"));
    await expect(saveLeadValue(null, form())).rejects.toThrow("Sessão expirada");
    expect(mocks.db.tenantLeadValue.updateMany).not.toHaveBeenCalled();
  });
  it.each(["0", "", "10000001,00"])("recusa valor inválido: %s", async value => {
    expect((await saveLeadValue(null, form("correct", value))).ok).toBe(false);
    expect(mocks.db.tenantLeadValue.updateMany).not.toHaveBeenCalled();
  });
});
