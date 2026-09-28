import { describe, expect, it } from "vitest";
import {
  nextBroadcastTime,
  parseBroadcastSchedule,
} from "@/modules/broadcasts/schedule";
import { csvCell } from "@/modules/broadcasts/csv";
const now = new Date("2026-09-27T12:00:00Z");
describe("agenda de disparos", () => {
  it("interpreta data local com o fuso escolhido", () => {
    const schedule = parseBroadcastSchedule(
      {
        date: "2026-09-28",
        time: "09:30",
        timezone: "America/Manaus",
        windowStart: "09:00",
        windowEnd: "18:00",
      },
      now,
    );
    expect(schedule.scheduledAt?.toISOString()).toBe(
      "2026-09-28T13:30:00.000Z",
    );
    expect(nextBroadcastTime(schedule, now)).toEqual(schedule.scheduledAt);
  });
  it("aguarda a faixa, respeita o fim exclusivo e vira o mês", () => {
    const schedule = parseBroadcastSchedule(
      { windowStart: "09:00", windowEnd: "18:00" },
      now,
    );
    expect(
      nextBroadcastTime(
        schedule,
        new Date("2026-09-30T21:00:00Z"),
      ).toISOString(),
    ).toBe("2026-10-01T12:00:00.000Z");
    expect(
      nextBroadcastTime(
        schedule,
        new Date("2026-09-30T11:00:00Z"),
      ).toISOString(),
    ).toBe("2026-09-30T12:00:00.000Z");
    expect(nextBroadcastTime(schedule, now)).toEqual(now);
  });
  it.each([
    { date: "2026-02-30", time: "12:00" },
    { date: "2026-09-26", time: "12:00" },
    { date: "2027-03-14", time: "02:30", timezone: "America/New_York" },
    { windowStart: "18:00", windowEnd: "09:00" },
    { windowStart: "09:00", windowEnd: "09:00" },
    { timezone: "inexistente" },
    { windowStart: "25:00" },
  ])("recusa agenda inválida %j", (input) =>
    expect(() => parseBroadcastSchedule(input, now)).toThrow(),
  );
});
describe("exportação segura", () => {
  it.each(["=SUM(1,2)", "+123", "@cmd", "-1+2", "  =formula", "\tcmd"])(
    "neutraliza %s",
    (value) => expect(csvCell(value)).toMatch(/^"'/),
  );
  it("preserva texto e escapa delimitadores", () =>
    expect(csvCell('Ana; "oi"')).toBe('"Ana; ""oi"""'));
});
