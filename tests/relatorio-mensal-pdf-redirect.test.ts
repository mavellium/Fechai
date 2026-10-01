import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  admin: vi.fn(), tenant: vi.fn(), product: vi.fn(), tenantRow: vi.fn(),
  report: vi.fn(), approved: vi.fn(), print: vi.fn(), legacy: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ requireSuperadmin: mocks.admin, requireTenant: mocks.tenant }));
vi.mock("@/lib/require-product", () => ({ requireProductAccess: mocks.product }));
vi.mock("@/lib/prisma", () => ({ prisma: { tenant: { findUnique: mocks.tenantRow } } }));
vi.mock("@/modules/reports/monthly", () => ({ computeMonthlyReport: mocks.report, loadApprovedReport: mocks.approved }));
vi.mock("@/modules/reports/monthly-pdf", () => ({ generateMonthlyPdf: mocks.legacy }));
vi.mock("@/modules/reports/monthly-print", async (original) => ({
  ...await original<typeof import("@/modules/reports/monthly-print")>(), printMonthlyPdf: mocks.print,
}));
import { GET as adminPdf } from "@/app/(admin)/admin/relatorios/[tenantId]/pdf/route";
import { GET as ownerPdf } from "@/app/(dashboard)/relatorios/mensal/pdf/route";
import { verifyPrintToken } from "@/lib/print-token";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("AUTH_SECRET", "test-print-secret-which-is-at-least-32-characters");
  vi.stubEnv("PDF_BASE_URL", "http://127.0.0.1:3000");
  mocks.admin.mockResolvedValue({}); mocks.product.mockResolvedValue({});
  mocks.tenant.mockResolvedValue({ tenantId: "own" });
  mocks.tenantRow.mockResolvedValue({ id: "own", status: "active" });
  const report = { data: {}, tenantName: "Clínica", status: "ready", snapshotVersion: 2 };
  mocks.report.mockResolvedValue(report); mocks.approved.mockResolvedValue(report);
  mocks.print.mockRejectedValue(new Error("Chromium unavailable"));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const request = () => new Request("https://localhost:3000/relatorios/mensal/pdf?mes=2026-09", {
  headers: { host: "localhost:3000", "x-forwarded-host": "other.example" },
});
describe("PDF atrás do proxy: fallback no domínio atual", () => {
  it.each(["admin", "owner"])("%s: ignora localhost e mantém escopo e assinatura do token", async (role) => {
    const response = role === "admin" ? await adminPdf(request(), { params: Promise.resolve({ tenantId: "own" }) }) : await ownerPdf(request());
    expect(response.status).toBe(303);
    const location = response.headers.get("location")!;
    expect(location.startsWith("/imprimir/relatorio-mensal?token=")).toBe(true);
    expect(location).not.toContain("localhost");
    expect(location).not.toContain("127.0.0.1");
    expect(location).not.toContain("other.example");
    const publicUrl = new URL(location, "https://fechai.januscms.com.br/relatorios");
    expect(publicUrl.origin).toBe("https://fechai.januscms.com.br");
    expect(verifyPrintToken(publicUrl.searchParams.get("token")!)).toMatchObject({ tenantId: "own", month: "2026-09", draft: role === "admin" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
  it("quando o Chromium funciona, baixa o PDF em vez de redirecionar", async () => {
    mocks.print.mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
    const response = await ownerPdf(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="fechai-relatorio-clinica-2026-09-v2.pdf"');
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([37, 80, 68, 70]);
  });
  it("sem snapshot aprovado não gera PDF nem token de fallback para o cliente", async () => {
    mocks.approved.mockResolvedValue(null);
    const response = await ownerPdf(request());
    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
    expect(mocks.print).not.toHaveBeenCalled();
  });
});
