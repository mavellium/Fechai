import { describe, expect, it } from "vitest";
import {
  isBlockedDate,
  isCalendarDate,
  isWithinBusinessHours,
  parseBlockedDates,
  parseScheduleConfig,
  scheduleSystemContext,
} from "@/modules/scheduling/config";
import { parseLocalDateTime } from "@/modules/scheduling/time";

/**
 * Data bloqueada é a EXCEÇÃO da grade semanal: a grade só conhece dia da
 * semana, então sem isto 25/12 numa quarta seria só mais uma quarta e o agente
 * marcaria consulta no Natal.
 */
const cfg = parseScheduleConfig({
  durationMinutes: 60,
  blockedDates: [
    { date: "2026-12-25", label: "Natal" },
    { date: "2026-12-24", label: "" },
  ],
});

const at = (date: string, time: string) => parseLocalDateTime(date, time, cfg.timezone)!;

describe("dias sem atendimento", () => {
  it("recusa horário em data bloqueada, mesmo em dia de atendimento", () => {
    // 25/12/2026 é uma sexta — dia liberado na grade padrão (seg–sex).
    expect(at("2026-12-25", "10:00").getUTCDay()).toBe(5);
    expect(isWithinBusinessHours(at("2026-12-25", "10:00"), cfg)).toBe(false);
  });

  it("não afeta os outros dias", () => {
    expect(isWithinBusinessHours(at("2026-12-18", "10:00"), cfg)).toBe(true);
  });

  it("bloqueia o dia inteiro, não só um horário", () => {
    for (const time of ["09:00", "12:00", "17:00"]) {
      expect(isBlockedDate(at("2026-12-25", time), cfg)).toBe(true);
    }
  });

  it("sem datas bloqueadas, nada muda", () => {
    const livre = parseScheduleConfig({ durationMinutes: 60 });
    expect(livre.blockedDates).toEqual([]);
    expect(isWithinBusinessHours(at("2026-12-25", "10:00"), livre)).toBe(true);
  });
});

describe("leitura da lista", () => {
  it("ordena, remove repetidas e descarta data inexistente", () => {
    const parsed = parseBlockedDates([
      { date: "2026-12-25", label: "Natal" },
      { date: "2026-01-01", label: "Ano Novo" },
      { date: "2026-12-25", label: "repetida" },
      { date: "2026-02-31", label: "não existe" },
      { date: "banana" },
      null,
    ]);
    expect(parsed.map((b) => b.date)).toEqual(["2026-01-01", "2026-12-25"]);
    // A primeira vence: o rótulo é o dela, não o da repetida.
    expect(parsed[1].label).toBe("Natal");
  });

  it("aceita lista de strings (formato sem rótulo)", () => {
    expect(parseBlockedDates(["2026-12-25"])).toEqual([{ date: "2026-12-25", label: "" }]);
  });

  it("nunca lança com entrada inválida", () => {
    for (const raw of [null, undefined, "texto", 42, {}]) {
      expect(parseBlockedDates(raw)).toEqual([]);
    }
  });

  it("valida o calendário de verdade, incluindo bissexto", () => {
    expect(isCalendarDate("2024-02-29")).toBe(true); // 2024 é bissexto
    expect(isCalendarDate("2026-02-29")).toBe(false);
    expect(isCalendarDate("2026-04-31")).toBe(false);
    expect(isCalendarDate("2026-13-01")).toBe(false);
  });
});

describe("o agente sabe explicar", () => {
  it("lista as datas futuras no prompt e manda oferecer outro dia", () => {
    const context = scheduleSystemContext(cfg, at("2026-12-01", "09:00"));
    expect(context).toContain("2026-12-25 (Natal)");
    expect(context).toContain("NÃO atendemos");
    expect(context).toContain("ofereça o dia seguinte");
  });

  it("omite datas que já passaram", () => {
    const context = scheduleSystemContext(cfg, at("2027-01-05", "09:00"));
    expect(context).not.toContain("2026-12-25");
  });
});
