import { describe, expect, it } from "vitest";
import { isReminderTypeAllowed, parseScheduleConfig, resolveDuration, resolveScheduleServiceType, scheduleSystemContext } from "@/modules/scheduling/config";

describe("público dos lembretes", () => {
  const cfg = parseScheduleConfig({ reminderAudience: "selected_types", reminderTypes: ["Avaliação"] });

  it.each(["Avaliação", "avaliacao", " AVALIAÇÃO "])("autoriza o mesmo tipo com caixa ou acento diferente: %s", (type) => {
    expect(isReminderTypeAllowed(cfg, type)).toBe(true);
  });
  it.each(["Reavaliação", "Ortodontia", "Cirurgia", "Avaliação para implante", null, undefined, ""])("exclui outro tipo ou classificação ausente: %s", (type) => {
    expect(isReminderTypeAllowed(cfg, type)).toBe(false);
  });
  it("preserva contas antigas sem restrição de tipos", () => {
    const old = parseScheduleConfig({ reminderEnabled: true, reminderMinutesBefore: 1440, reminderTemplate: "É amanhã." });
    expect(old.reminderAudience).toBe("all");
    expect(old.reminders).toEqual([{ minutesBefore: 1440, template: "É amanhã." }]);
    expect(isReminderTypeAllowed(old, null)).toBe(true);
  });
  it("permite escolher vários tipos e trocar a seleção pela configuração", () => {
    const first = parseScheduleConfig({ reminderAudience: "selected_types", reminderTypes: ["Avaliação", "Ortodontia"] });
    expect(isReminderTypeAllowed(first, "Avaliação")).toBe(true);
    expect(isReminderTypeAllowed(first, "Ortodontia")).toBe(true);
    expect(isReminderTypeAllowed(first, "Retorno")).toBe(false);
    const changed = parseScheduleConfig({ ...first, reminderTypes: ["Retorno"] });
    expect(isReminderTypeAllowed(changed, "Retorno")).toBe(true);
    expect(isReminderTypeAllowed(changed, "Avaliação")).toBe(false);
  });
  it.each([null, "inválido", false, {}])("configuração de público inválida não libera todos: %j", (audience) => {
    const broken = parseScheduleConfig({ reminderAudience: audience });
    expect(broken.reminderAudience).toBe("selected_types");
    expect(isReminderTypeAllowed(broken, "Avaliação")).toBe(false);
  });
  it("lista inválida não amplia o público e nomes repetidos viram um só", () => {
    expect(isReminderTypeAllowed(parseScheduleConfig({ reminderAudience: "selected_types", reminderTypes: "Avaliação" }), "Avaliação")).toBe(false);
    expect(parseScheduleConfig({ reminderTypes: [null, "", " Avaliação ", "avaliacao", 12, "a".repeat(61)] }).reminderTypes).toEqual(["Avaliação"]);
  });
  it("registra tipo permitido sem exigir uma variação de duração", () => {
    expect(resolveScheduleServiceType(cfg, "avaliacao")).toBe("Avaliação");
    expect(resolveScheduleServiceType(cfg, "Reavaliação")).toBeNull();
    expect(resolveDuration(cfg, "Avaliação")).toMatchObject({ minutes: cfg.durationMinutes, matched: false });
    expect(scheduleSystemContext(cfg)).toContain("Tipos que recebem lembrete: Avaliação");
  });
});
