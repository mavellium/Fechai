import { describe, expect, it } from "vitest";
import { isWithinBusinessHours, parseScheduleConfig, scheduleSystemContext, validateScheduleBreaks } from "@/modules/scheduling/config";
import { parseLocalDateTime } from "@/modules/scheduling/time";

const cfg = parseScheduleConfig({ durationMinutes: 60, breaks: [
  { label: "Almoço", startTime: "12:00", endTime: "13:00" },
  { label: "Café", startTime: "15:30", endTime: "15:45" },
] });
const at = (time: string) => parseLocalDateTime("2026-09-17", time, cfg.timezone)!;

describe("expediente com pausas", () => {
  it.each([["11:00", true], ["11:30", false], ["12:00", false], ["12:30", false], ["13:00", true], ["14:45", false], ["15:30", false], ["15:45", true], ["17:00", true], ["17:30", false]] as const)("consulta às %s disponível=%s", (time, allowed) => {
    expect(isWithinBusinessHours(at(time), cfg)).toBe(allowed);
  });
  it("respeita dias fechados", () => {
    expect(isWithinBusinessHours(parseLocalDateTime("2026-09-20", "10:00", cfg.timezone)!, cfg)).toBe(false);
  });
  it("informa as pausas e as regras de confirmação ao agente", () => {
    const context = scheduleSystemContext({ ...cfg, allowCancellation: true, allowRescheduling: true });
    expect(context).toContain("Almoço");
    expect(context).toContain("12:00–13:00");
    expect(context).toContain("ESPERE a próxima mensagem");
    expect(context).toContain("Não reinicie o agendamento");
  });
  it("recusa pausas invertidas, fora do expediente e sobrepostas", () => {
    for (const breaks of [
      [{ label: "", startTime: "13:00", endTime: "12:00" }],
      [{ label: "", startTime: "08:00", endTime: "10:00" }],
      [{ label: "", startTime: "12:00", endTime: "13:00" }, { label: "", startTime: "12:30", endTime: "14:00" }],
    ]) expect(validateScheduleBreaks({ ...cfg, breaks })).toBeTruthy();
    expect(validateScheduleBreaks(cfg)).toBeNull();
  });
});

describe("compatibilidade de configurações", () => {
  it("preserva expediente antigo sem habilitar cancelamento/reagendamento sozinho", () => {
    expect(parseScheduleConfig({ startTime: "08:30", endTime: "17:00", workdays: [2, 6] })).toMatchObject({
      startTime: "08:30", endTime: "17:00", workdays: [2, 6], breaks: [],
      allowCancellation: false, allowRescheduling: false, recognizeExisting: true,
    });
  });
  it.each([null, [], "inválido", { timezone: "inexistente", startTime: "99:99", breaks: [null, {}, { startTime: "12:90" }] }])("tolera JSON antigo ou malformado: %j", (raw) => {
    const parsed = parseScheduleConfig(raw);
    expect(() => scheduleSystemContext(parsed)).not.toThrow();
    expect(() => isWithinBusinessHours(at("10:00"), parsed)).not.toThrow();
  });
  it("não trata a string false como ligada", () => {
    expect(parseScheduleConfig({ allowCancellation: "false", allowRescheduling: "true" })).toMatchObject({ allowCancellation: false, allowRescheduling: false });
  });
});
