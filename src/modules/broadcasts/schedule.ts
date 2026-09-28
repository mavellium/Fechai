import {
  parseLocalDateTime,
  partsInZone,
  zonedTimeToUtc,
  dayKeyInZone,
  timeInZone,
} from "@/modules/scheduling/time";

export type BroadcastSchedule = {
  scheduledAt: Date | null;
  timezone: string;
  windowStart: number;
  windowEnd: number;
};
export type ScheduleInput = {
  date?: string;
  time?: string;
  timezone?: string;
  windowStart?: string;
  windowEnd?: string;
};
const minutes = (value: string) => {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))
    throw new Error("Horário inválido.");
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
};
export function parseBroadcastSchedule(
  input: ScheduleInput = {},
  now = new Date(),
): BroadcastSchedule {
  const timezone = input.timezone || "America/Sao_Paulo";
  try {
    partsInZone(now, timezone);
  } catch {
    throw new Error("Fuso horário inválido.");
  }
  let scheduledAt: Date | null = null;
  if (input.date || input.time) {
    scheduledAt = parseLocalDateTime(
      input.date ?? "",
      input.time ?? "",
      timezone,
    );
    if (
      !scheduledAt ||
      dayKeyInZone(scheduledAt, timezone) !== input.date ||
      timeInZone(scheduledAt, timezone) !== input.time
    )
      throw new Error("Data ou horário inexistente no fuso escolhido.");
    if (scheduledAt <= now)
      throw new Error("Escolha um horário futuro para agendar.");
  }
  const windowStart = input.windowStart ? minutes(input.windowStart) : 0;
  const windowEnd = input.windowEnd ? minutes(input.windowEnd) : 1440;
  if (windowStart >= windowEnd)
    throw new Error(
      "O fim da faixa de envio deve ser depois do início, no mesmo dia.",
    );
  return { scheduledAt, timezone, windowStart, windowEnd };
}

export function nextBroadcastTime(
  schedule: BroadcastSchedule,
  now = new Date(),
): Date {
  const candidate =
    schedule.scheduledAt && schedule.scheduledAt > now
      ? schedule.scheduledAt
      : now;
  const p = partsInZone(candidate, schedule.timezone);
  const minute = p.hour * 60 + p.minute;
  if (minute >= schedule.windowStart && minute < schedule.windowEnd)
    return candidate;
  return zonedTimeToUtc(
    p.year,
    p.month,
    p.day + (minute >= schedule.windowEnd ? 1 : 0),
    Math.floor(schedule.windowStart / 60),
    schedule.windowStart % 60,
    schedule.timezone,
  );
}
