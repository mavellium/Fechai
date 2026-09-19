import type { ScheduleConfig } from "./config";

/** Minutos locais, intervalo [start, end). 1440 é o fim do dia (24:00). */
export type AvailabilityRange = { start: number; end: number };
/** Sempre sete dias, começando no domingo. [] em um dia significa fechado. */
export type WeeklyAvailability = AvailabilityRange[][];
export const emptyWeek = (): WeeklyAvailability => Array.from({ length: 7 }, () => []);
export const minuteLabel = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const minutesOf = (time: string) => { const [h, m] = time.split(":").map(Number); return h * 60 + m; };

export function mergeRanges(ranges: AvailabilityRange[]): AvailabilityRange[] {
  const result: AvailabilityRange[] = [];
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    const last = result[result.length - 1];
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else result.push({ ...range });
  }
  return result;
}

export function removeRange(ranges: AvailabilityRange[], cut: AvailabilityRange): AvailabilityRange[] {
  return ranges.flatMap((range) => {
    if (cut.start >= range.end || cut.end <= range.start) return [{ ...range }];
    return [
      ...(range.start < cut.start ? [{ start: range.start, end: cut.start }] : []),
      ...(range.end > cut.end ? [{ start: cut.end, end: range.end }] : []),
    ];
  });
}

function validRange(raw: unknown): raw is AvailabilityRange {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as AvailabilityRange;
  return Number.isInteger(r.start) && Number.isInteger(r.end) && r.start >= 0 && r.end <= 1440 && r.start < r.end;
}

/** Nunca abre um horário por fallback quando a grade existe, mas está inválida. */
export function parseWeeklyAvailability(raw: unknown): WeeklyAvailability {
  return Array.from({ length: 7 }, (_, day) => mergeRanges(
    Array.isArray(raw) && Array.isArray(raw[day]) ? raw[day].filter(validRange).slice(0, 96) : [],
  ));
}

export function validateWeeklyAvailability(raw: unknown): string | null {
  if (!Array.isArray(raw) || raw.length !== 7 || raw.some((day) => !Array.isArray(day) || day.length > 96 || day.some((range: unknown) => !validRange(range)))) {
    return "Horários inválidos. Confira os períodos selecionados na semana.";
  }
  return null;
}

/** Converte o formato antigo sem arredondar minutos nem perder pausas. */
export function getWeeklyAvailability(cfg: Pick<ScheduleConfig, "weeklyAvailability" | "workdays" | "startTime" | "endTime" | "breaks">): WeeklyAvailability {
  if (cfg.weeklyAvailability !== undefined) return cfg.weeklyAvailability;
  let periods = [{ start: minutesOf(cfg.startTime), end: minutesOf(cfg.endTime) }];
  for (const pause of cfg.breaks) periods = removeRange(periods, { start: minutesOf(pause.startTime), end: minutesOf(pause.endTime) });
  return Array.from({ length: 7 }, (_, day) => cfg.workdays.includes(day) ? periods.map((r) => ({ ...r })) : []);
}

/** Pinta um retângulo a partir do estado inicial do gesto, inclusive ao voltar o mouse. */
export function paintAvailability(week: WeeklyAvailability, firstDay: number, lastDay: number, start: number, end: number, available: boolean): WeeklyAvailability {
  return week.map((ranges, day) => day < Math.min(firstDay, lastDay) || day > Math.max(firstDay, lastDay)
    ? ranges
    : available ? mergeRanges([...ranges, { start, end }]) : removeRange(ranges, { start, end }));
}

export function rangeCoverage(ranges: AvailabilityRange[], start: number, end: number): number {
  return ranges.reduce((total, range) => total + Math.max(0, Math.min(end, range.end) - Math.max(start, range.start)), 0);
}

export function describeRanges(ranges: AvailabilityRange[]): string {
  return ranges.length ? ranges.map((r) => `${minuteLabel(r.start)}–${minuteLabel(r.end)}`).join(", ") : "Fechado";
}
