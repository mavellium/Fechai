import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ save: vi.fn(), owned: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireTenant: vi.fn(async () => ({ tenantId: "conta-logada" })) }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/rate-limit", () => ({ payloadTooLarge: vi.fn(() => null) }));
vi.mock("@/modules/agent-engine/agents", () => ({ getAgentOwned: mocks.owned }));
vi.mock("@/modules/scheduling/repository", () => ({ saveScheduleConfig: mocks.save }));
vi.mock("@/modules/whatsapp", () => ({}));
vi.mock("@/lib/widget/deploy", () => ({}));
vi.mock("@/lib/bunny", () => ({}));
vi.mock("@/modules/audit/log", () => ({}));
import { saveScheduleConfigAction } from "@/app/(dashboard)/agentes/actions";
import { emptyWeek } from "@/modules/scheduling/weekly-availability";

function form(week: unknown = emptyWeek()) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ agentId: "agente", tenantId: "conta-forjada", weeklyAvailability: JSON.stringify(week), startTime: "09:00", endTime: "18:00", durationMinutes: "30", timezone: "America/Sao_Paulo", minNoticeHours: "2", allowCancellation: "true", allowRescheduling: "true", recognizeExisting: "true", reminderEnabled: "false", breaks: "[]", durations: "[]", reminders: "[]" })) data.set(key, value);
  return data;
}
beforeEach(() => { vi.clearAllMocks(); mocks.owned.mockResolvedValue({ id: "agente" }); mocks.save.mockResolvedValue(undefined); });

describe("salvamento da grade semanal", () => {
  it("salva a grade normalizada somente na conta autenticada, sem precisar dos checkboxes antigos", async () => {
    const week = emptyWeek();
    week[0] = [{ start: 1380, end: 1440 }];
    week[2] = [{ start: 540, end: 720 }, { start: 720, end: 780 }];
    expect(await saveScheduleConfigAction(null, form(week))).toMatchObject({ ok: true });
    expect(mocks.owned).toHaveBeenCalledWith("conta-logada", "agente");
    expect(mocks.save).toHaveBeenCalledWith("conta-logada", "agente", expect.objectContaining({ workdays: [0, 2], weeklyAvailability: [week[0], [], [{ start: 540, end: 780 }], [], [], [], []], breaks: [] }));
  });
  it("permite salvar semana totalmente fechada", async () => {
    expect(await saveScheduleConfigAction(null, form())).toMatchObject({ ok: true });
    expect(mocks.save).toHaveBeenCalledWith("conta-logada", "agente", expect.objectContaining({ weeklyAvailability: emptyWeek(), workdays: [] }));
  });
  it("recusa JSON inválido e períodos fora do dia sem gravar", async () => {
    for (const raw of ["{", JSON.stringify([[{ start: 0, end: 1500 }], ...emptyWeek().slice(1)])]) {
      const data = form(); data.set("weeklyAvailability", raw);
      expect(await saveScheduleConfigAction(null, data)).toMatchObject({ ok: false });
    }
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("continua aceitando formulários antigos e recusa agente de outra conta", async () => {
    const data = form(); data.delete("weeklyAvailability"); data.append("workdays", "1");
    expect(await saveScheduleConfigAction(null, data)).toMatchObject({ ok: true });
    expect(mocks.save.mock.calls[0][2]).not.toHaveProperty("weeklyAvailability");
    mocks.save.mockClear(); mocks.owned.mockResolvedValue(null);
    expect(await saveScheduleConfigAction(null, form())).toMatchObject({ ok: false });
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
