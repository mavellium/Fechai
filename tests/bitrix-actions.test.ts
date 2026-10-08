import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ product: vi.fn(), tenant: vi.fn(), active: vi.fn(), save: vi.fn(), disconnect: vi.fn(), test: vi.fn(), enabled: vi.fn(), retry: vi.fn(), resolve: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/require-product", () => ({ requireProductAccess: mock.product }));
vi.mock("@/lib/session", () => ({ requireTenant: mock.tenant }));
vi.mock("@/lib/prisma", () => ({ prisma: { tenant: { findUnique: mock.active } } }));
vi.mock("next/cache", () => ({ revalidatePath: mock.refresh }));
vi.mock("@/modules/bitrix/integration", () => ({ saveBitrix: mock.save, disconnectBitrix: mock.disconnect, testBitrix: mock.test, setBitrixEnabled: mock.enabled, retryBitrix: mock.retry, resolveUncertainBitrix: mock.resolve }));
import { manageBitrixAction, saveBitrixAction } from "@/app/(dashboard)/integracoes/bitrix-actions";
beforeEach(() => { vi.resetAllMocks(); mock.tenant.mockResolvedValue({ tenantId: "authorized" }); mock.active.mockResolvedValue({ status: "active" }); });
describe("Bitrix24: autorização das ações", () => {
  it("exige acesso ao produto antes de qualquer consulta", async () => {
    mock.product.mockRejectedValue(new Error("Redirect"));
    await expect(saveBitrixAction(null, new FormData())).rejects.toThrow("Redirect");
    expect(mock.tenant).not.toHaveBeenCalled(); expect(mock.save).not.toHaveBeenCalled();
  });
  it.each(["save", "pause", "resume", "disconnect", "test", "retry", "resolve"])("conta suspensa não pode executar %s", async (operation) => {
    mock.active.mockResolvedValue({ status: "suspended" }); const data = new FormData(); data.set("operation", operation);
    const result = operation === "save" ? await saveBitrixAction(null, data) : await manageBitrixAction(null, data);
    expect(result).toMatchObject({ ok: false, code: "forbidden" });
    for (const action of [mock.save, mock.disconnect, mock.test, mock.enabled, mock.retry, mock.resolve]) expect(action).not.toHaveBeenCalled();
  });
  it("usa tenant da sessão, nunca um tenant enviado pelo formulário", async () => {
    const data = new FormData(); data.set("tenantId", "attacker"); data.set("webhook", "url"); data.set("syncLeads", "on"); data.set("syncAppointments", "on");
    expect(await saveBitrixAction(null, data)).toHaveProperty("ok", true);
    expect(mock.save).toHaveBeenCalledWith("authorized", { webhook: "url", syncLeads: true, syncAppointments: true, responsibleId: "" });
  });
  it("operação inexistente não muda configuração", async () => {
    const data = new FormData(); data.set("operation", "delete-all");
    expect(await manageBitrixAction(null, data)).toMatchObject({ ok: false, code: "validation" });
    expect(mock.disconnect).not.toHaveBeenCalled();
  });
});

it("resolver usa confirmação do formulário e tenant da sessão", async () => {
  const data = new FormData(); data.set("operation", "resolve"); data.set("jobId", "job-x"); data.set("confirmedMissing", "on"); data.set("tenantId", "attacker");
  expect(await manageBitrixAction(null, data)).toHaveProperty("ok", true);
  expect(mock.resolve).toHaveBeenCalledWith("authorized", "job-x", true);
});
