import type { PlanKey } from "@prisma/client";
import { planOf } from "@/modules/billing/plans";
import { isScheduleTime, parseScheduleConfig } from "@/modules/scheduling/config";
import { TIMEZONES, partsInZone } from "@/modules/scheduling/time";
import { getWeeklyAvailability, mergeRanges, validateWeeklyAvailability, type WeeklyAvailability } from "@/modules/scheduling/weekly-availability";
import { monthKey, type MonthlyAssumptions } from "./monthly-config";

export type MonthlyAgentSource = {
  id: string; name: string; isPrimary: boolean; archived: boolean;
  schedule: { timezone: string; hours: WeeklyAvailability; types: string[] } | null;
};
export type MonthlyImportSources = {
  priceCents: number; priceLabel: string; agents: MonthlyAgentSource[];
};

export function monthlyAccountPrice(tenant: { planKey?: PlanKey; priceCentsOverride?: number | null }) {
  const plan = planOf(tenant.planKey);
  return { priceCents: tenant.priceCentsOverride ?? plan.priceCents,
    priceLabel: tenant.priceCentsOverride != null ? "Preço negociado da conta" : `Plano ${plan.name} atual` };
}

/** Importa somente uma grade cadastrada, nunca os horários padrão do parser. */
export function monthlyAgentSource(agent: {
  id: string; name: string; isPrimary: boolean; archived: boolean;
  actions: { key: string; config: unknown }[];
}): MonthlyAgentSource {
  const result: MonthlyAgentSource = { id: agent.id, name: agent.name, isPrimary: agent.isPrimary, archived: agent.archived, schedule: null };
  const raw = agent.actions.find((a) => a.key === "schedule_meeting")?.config;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;
  const c = raw as Record<string, unknown>;
  const valid = c.weeklyAvailability !== undefined ? !validateWeeklyAvailability(c.weeklyAvailability)
    : Array.isArray(c.workdays) && c.workdays.every((d) => Number.isInteger(d) && Number(d) >= 0 && Number(d) <= 6)
      && isScheduleTime(c.startTime) && isScheduleTime(c.endTime)
      && Number(c.startTime.split(":")[0]) * 60 + Number(c.startTime.split(":")[1]) < Number(c.endTime.split(":")[0]) * 60 + Number(c.endTime.split(":")[1]);
  if (!valid || !TIMEZONES.some((zone) => zone.value === c.timezone)) return result;
  const config = parseScheduleConfig(raw);
  result.schedule = { timezone: config.timezone, hours: getWeeklyAvailability(config), types: config.durations.map((d) => d.label) };
  return result;
}

export function selectedMonthlyAgents(agents: MonthlyAgentSource[], ids: string[]) {
  return ids.length ? agents.filter((agent) => ids.includes(agent.id)) : agents;
}

/** União da grade dos agentes, ainda sujeita à conferência do expediente humano. */
export function monthlyScheduleSuggestion(agents: MonthlyAgentSource[], ids: string[]) {
  const selected = selectedMonthlyAgents(agents, ids);
  const schedules = selected.flatMap((agent) => agent.schedule ? [{ ...agent.schedule, name: agent.name }] : []);
  const names = schedules.map((s) => s.name);
  if (!schedules.length) return { hours: null, timezone: null, names, warning: "Os agentes selecionados não têm uma grade de horários cadastrada." };
  if (new Set(schedules.map((s) => s.timezone)).size !== 1) return { hours: null, timezone: null, names, warning: "Os agentes usam fusos diferentes. Defina o expediente humano e o fuso desta revisão." };
  const hours = Array.from({ length: 7 }, (_, day) => mergeRanges(schedules.flatMap((s) => s.hours[day])));
  if (hours.some((day) => day.length > 4)) return { hours: null, timezone: null, names, warning: "A união das grades tem mais de quatro turnos em um dia. Confira e defina o expediente humano." };
  return { hours, timezone: schedules[0].timezone, names,
    warning: schedules.length < selected.length ? "Alguns agentes não têm grade cadastrada; confira o expediente completo da equipe." : null };
}

export function sameMonthlyAgentScope(a: MonthlyAssumptions, b: MonthlyAssumptions) {
  return [...(a.agentIds ?? [])].sort().join("\n") === [...(b.agentIds ?? [])].sort().join("\n");
}

/** Uma conta nova não abre por padrão uma competência anterior ao cadastro. */
export function monthlyInitialMonth(createdAt: Date, requested?: string, latest?: string, now = new Date()) {
  const p = partsInZone(createdAt, "America/Sao_Paulo");
  const first = `${p.year}-${String(p.month).padStart(2, "0")}`;
  const month = monthKey(requested ?? latest, now);
  return month < first ? first : month;
}
