import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
const findMany = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: { monthlyRoiReport: { findMany } } }));
import { publishedMonthlyMonths, selectPublishedMonth } from "@/modules/reports/monthly-publication";

describe("relatórios disponíveis no painel do tenant", () => {
  it("lista só publicações com snapshot do tenant da sessão, da mais recente para a mais antiga", async () => {
    findMany.mockResolvedValue([{ month: "2026-08" }, { month: "2026-06" }]);
    expect(await publishedMonthlyMonths("own")).toEqual(["2026-08", "2026-06"]);
    expect(findMany).toHaveBeenCalledWith({ where: { tenantId: "own", status: "ready", snapshot: { not: Prisma.DbNull } }, select: { month: true }, orderBy: { month: "desc" } });
  });
  it("não oferece a visão mensal quando não há publicações", () => {
    expect(selectPublishedMonth([], "2026-08")).toBeNull();
  });
  it("abre a publicação mais recente mesmo quando o mês anterior ainda não foi publicado", () => {
    expect(selectPublishedMonth(["2026-08", "2026-06"])).toBe("2026-08");
  });
  it("preserva a competência publicada escolhida e ignora meses ausentes ou inválidos", () => {
    const months = ["2026-08", "2026-06"];
    expect(selectPublishedMonth(months, "2026-06")).toBe("2026-06");
    expect(selectPublishedMonth(months, "2026-07")).toBe("2026-08");
    expect(selectPublishedMonth(months, "invalid")).toBe("2026-08");
  });
});
