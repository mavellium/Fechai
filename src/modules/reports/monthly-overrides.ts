import { z } from "zod";
import { normalizeLabel, type MonthlyAssumptions } from "./monthly-config";
import type { MonthlyMetrics } from "./monthly";

const count = z.number().int().min(0).max(10_000_000);
const split = z.object({ inside: count.optional(), outside: count.optional(), unclassified: count.optional() }).strict();
export const monthlyMetricOverrideSchema = z.object({
  newContacts: count.optional(), conversations: split.optional(),
  firstResponseSeconds: z.number().finite().min(0).max(31_536_000).nullable().optional(),
  scheduled: split.optional(), attended: split.optional(), attendanceUnknown: count.optional(),
  untypedAppointments: count.optional(), qualified: count.optional(), handoffs: count.optional(), unanswered: count.optional(),
  aiOnlyConversations: count.optional(), assumedHours: z.number().finite().min(0).max(100_000).nullable().optional(),
  procedures: z.array(z.object({ name: z.string().trim().min(1).max(60), qualified: count, attendedOutside: count }).strict()).max(40)
    .refine((rows) => new Set(rows.map((p) => normalizeLabel(p.name))).size === rows.length, "Procedimento duplicado nos indicadores.").optional(),
  peaks: z.array(z.object({ hour: z.number().int().min(0).max(23), messages: count }).strict()).max(3)
    .refine((rows) => new Set(rows.map((p) => p.hour)).size === rows.length, "Horário de pico duplicado.").optional(),
}).strict();
export const monthlyOverridesSchema = z.object({ current: monthlyMetricOverrideSchema, previous: monthlyMetricOverrideSchema }).strict();
export type MonthlyMetricOverrides = z.infer<typeof monthlyMetricOverrideSchema>;
export type MonthlyOverrides = z.infer<typeof monthlyOverridesSchema>;

export function editableMonthlyMetrics(m: MonthlyMetrics): MonthlyMetricOverrides {
  return { newContacts: m.newContacts, conversations: m.conversations, firstResponseSeconds: m.firstResponseSeconds,
    scheduled: m.scheduled, attended: m.attended, attendanceUnknown: m.attendanceUnknown, untypedAppointments: m.untypedAppointments,
    qualified: m.qualified, handoffs: m.handoffs, unanswered: m.unanswered, aiOnlyConversations: m.aiOnlyConversations, assumedHours: m.assumedHours,
    procedures: m.procedures.map(({ name, qualified, attendedOutside }) => ({ name, qualified, attendedOutside })), peaks: m.peaks };
}

// O documento JSON existente guarda premissas + correções da competência.
// Correções nunca são herdadas pelo mês seguinte.
export function parseMonthlyOverrides(raw: unknown): MonthlyOverrides {
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>).metricOverrides : undefined;
  const result = monthlyOverridesSchema.safeParse(value);
  return result.success ? result.data : { current: {}, previous: {} };
}

/** Recalcula dinheiro a partir dos dados conferidos, mantendo a regra de receita fora do expediente. */
export function applyMonthlyOverrides(auto: MonthlyMetrics, overrides: MonthlyMetricOverrides, config: MonthlyAssumptions): MonthlyMetrics {
  const m: MonthlyMetrics = { ...auto, ...overrides,
    conversations: { ...auto.conversations, ...overrides.conversations }, scheduled: { ...auto.scheduled, ...overrides.scheduled },
    attended: { ...auto.attended, ...overrides.attended }, procedures: [], missing: [],
  };
  m.assumedHours = overrides.assumedHours !== undefined ? overrides.assumedHours
    : config.minutesPerConversation === null ? null : m.aiOnlyConversations * config.minutesPerConversation / 60;
  m.savingsCents = m.assumedHours !== null && config.attendantMonthlyCents !== null && config.attendantMonthlyHours
    ? Math.round(m.assumedHours * config.attendantMonthlyCents / config.attendantMonthlyHours) : null;
  m.procedures = (overrides.procedures ?? auto.procedures).map((p) => {
    const premise = config.procedures.find((c) => normalizeLabel(c.name) === normalizeLabel(p.name));
    const revenueCents = p.attendedOutside === 0 ? 0 : premise?.ticketCents != null && premise.conversionBps != null
      ? Math.round(p.attendedOutside * premise.ticketCents * premise.conversionBps / 10_000) : null;
    return { ...p, revenueCents };
  });
  if (!config.humanHours) m.missing.push("Horário humano não informado.");
  if (m.attendanceUnknown) m.missing.push(`${m.attendanceUnknown} avaliação(ões) sem comparecimento confirmado.`);
  if (m.untypedAppointments) m.missing.push(`${m.untypedAppointments} agendamento(s) sem tipo de atendimento; confira se são avaliações.`);
  if (m.attended.unclassified) m.missing.push("Há avaliações realizadas sem horário de chegada do contato.");
  if (m.procedures.some((p) => p.revenueCents === null)) m.missing.push("Faltam procedimento, ticket ou conversão de avaliações realizadas fora do horário.");
  if (!config.procedures.length) m.missing.push("Ticket e conversão por procedimento ainda não informados.");
  if (config.procedures.some((p) => p.ticketCents === null || p.conversionBps === null)) m.missing.push("Há procedimentos sem ticket ou conversão nas premissas.");
  // Uma correção não pode criar receita maior que o total de presenças fora do expediente.
  const outside = m.procedures.reduce((sum, p) => sum + p.attendedOutside, 0);
  if (outside !== m.attended.outside) m.missing.push("Confira as avaliações realizadas fora do horário: o total deve corresponder à soma por procedimento.");
  m.revenueCents = m.missing.length === 0 ? m.procedures.reduce((sum, p) => sum + (p.revenueCents ?? 0), 0) : null;
  if (m.savingsCents === null) m.missing.push("Informe custo, carga mensal do atendente e horas assumidas ou minutos por conversa para a economia estimada.");
  m.investmentCents = config.investmentCents;
  if (m.investmentCents === null) m.missing.push("Mensalidade não informada.");
  m.roiPercent = m.revenueCents !== null && m.savingsCents !== null && m.investmentCents !== null && m.investmentCents > 0
    ? Math.round((m.revenueCents + m.savingsCents - m.investmentCents) / m.investmentCents * 1000) / 10 : null;
  return m;
}
