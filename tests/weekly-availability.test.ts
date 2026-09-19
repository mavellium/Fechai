import { describe, expect, it } from "vitest";
import { getWeeklyAvailability, emptyWeek, paintAvailability, parseWeeklyAvailability, validateWeeklyAvailability } from "@/modules/scheduling/weekly-availability";
import { isWithinBusinessHours, parseScheduleConfig, scheduleSystemContext, slotStartTimes } from "@/modules/scheduling/config";
import { parseLocalDateTime } from "@/modules/scheduling/time";

describe("grade semanal de atendimento", () => {
  it("converte expediente e pausas antigos preservando minutos exatos", () => {
    const cfg = parseScheduleConfig({ workdays: [1, 6], startTime: "08:10", endTime: "17:45", breaks: [{ label: "Almoço", startTime: "12:15", endTime: "13:20" }] });
    const week = getWeeklyAvailability(cfg);
    expect(week[1]).toEqual([{ start: 490, end: 735 }, { start: 800, end: 1065 }]);
    expect(week[6]).toEqual(week[1]);
    expect(week[0]).toEqual([]);
    expect(week[2]).toEqual([]);
  });
  it("arraste marca vários dias e horas sem alterar a base; arraste inverso remove e divide períodos", () => {
    const base = emptyWeek();
    const selected = paintAvailability(base, 4, 1, 540, 1080, true);
    expect(base.flat()).toEqual([]);
    expect(selected[2]).toEqual([{ start: 540, end: 1080 }]);
    expect(selected[5]).toEqual([]);
    const lunch = paintAvailability(selected, 1, 4, 720, 780, false);
    expect(lunch[1]).toEqual([{ start: 540, end: 720 }, { start: 780, end: 1080 }]);
    expect(paintAvailability(lunch, 1, 4, 720, 780, true)).toEqual(selected);
  });
  it("respeita horários diferentes por dia e não atravessa pausas", () => {
    const week = emptyWeek();
    week[1] = [{ start: 540, end: 720 }, { start: 780, end: 1080 }];
    week[2] = [{ start: 840, end: 1020 }];
    const cfg = parseScheduleConfig({ weeklyAvailability: week, durationMinutes: 60 });
    const allowed = (date: string, time: string) => isWithinBusinessHours(parseLocalDateTime(date, time, cfg.timezone)!, cfg);
    expect(allowed("2026-09-21", "09:00")).toBe(true);
    expect(allowed("2026-09-22", "09:00")).toBe(false);
    expect(allowed("2026-09-21", "11:30")).toBe(false);
    expect(allowed("2026-09-21", "13:00")).toBe(true);
    expect(slotStartTimes(cfg, 2)).toEqual(["14:00", "15:00", "16:00"]);
    expect(slotStartTimes(cfg, 0)).toEqual([]);
    expect(scheduleSystemContext(cfg)).toContain("Segunda: 09:00–12:00, 13:00–18:00");
    expect(scheduleSystemContext(cfg)).toContain("Domingo: Fechado");
  });
  it("permite terminar exatamente à meia-noite, mas não ultrapassar o dia", () => {
    const week = emptyWeek();
    week[6] = [{ start: 1380, end: 1440 }];
    const cfg = parseScheduleConfig({ weeklyAvailability: week, durationMinutes: 60 });
    expect(slotStartTimes(cfg, 6)).toEqual(["23:00"]);
    expect(isWithinBusinessHours(parseLocalDateTime("2026-09-19", "23:00", cfg.timezone)!, cfg)).toBe(true);
    expect(isWithinBusinessHours(parseLocalDateTime("2026-09-19", "23:30", cfg.timezone)!, cfg)).toBe(false);
  });
  it("semana vazia ou inválida não reabre o expediente antigo", () => {
    for (const raw of [emptyWeek(), null, "inválida", [null]]) {
      const cfg = parseScheduleConfig({ weeklyAvailability: raw });
      expect(getWeeklyAvailability(cfg).flat()).toEqual([]);
      expect(isWithinBusinessHours(parseLocalDateTime("2026-09-21", "10:00", cfg.timezone)!, cfg)).toBe(false);
    }
  });
  it("valida os sete dias, limites e minutos inteiros, unindo intervalos adjacentes", () => {
    expect(validateWeeklyAvailability(emptyWeek())).toBeNull();
    for (const invalid of [[], {}, [[{ start: -1, end: 60 }], ...emptyWeek().slice(1)], [[{ start: 40, end: 20 }], ...emptyWeek().slice(1)], [[{ start: 0, end: 1441 }], ...emptyWeek().slice(1)], [[{ start: 0.5, end: 60 }], ...emptyWeek().slice(1)]]) expect(validateWeeklyAvailability(invalid)).toBeTruthy();
    const week = emptyWeek();
    week[0] = [{ start: 60, end: 120 }, { start: 0, end: 60 }];
    expect(parseWeeklyAvailability(week)[0]).toEqual([{ start: 0, end: 120 }]);
  });
});
