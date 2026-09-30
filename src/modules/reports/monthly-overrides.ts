import { z } from "zod";
import { normalizeLabel, type MonthlyAssumptions } from "./monthly-config";
import type { MonthlyMetrics } from "./monthly";
import { returnedHours } from "./monthly-time";
import { blocksRevenue, detectMonthlyPendencies } from "./monthly-pendencies";

const count = z.number().int().min(0).max(10_000_000);
const split = z.object({ inside: count.optional(), outside: count.optional(), unclassified: count.optional() }).strict();
// Só os números do tempo devolvido que entram na conta (e os destaques). A
// duração dos atendimentos é informativa, fora do dinheiro, e não se corrige.
export const timeOverrideSchema = z.object({
  textMessages: count.optional(), audios: count.optional(), unmeasuredAudios: count.optional(), longAudios: count.optional(),
  audioMinutes: z.number().finite().min(0).max(10_000_000).optional(),
  longestAudioSeconds: z.number().finite().min(0).max(86_400).nullable().optional(),
}).strict();
export const monthlyMetricOverrideSchema = z.object({
  newContacts: count.optional(), conversations: split.optional(),
  firstResponseSeconds: z.number().finite().min(0).max(31_536_000).nullable().optional(),
  scheduled: split.optional(), attended: split.optional(), attendanceUnknown: count.optional(),
  untypedAppointments: count.optional(), qualified: count.optional(), handoffs: count.optional(), unanswered: count.optional(),
  aiOnlyConversations: count.optional(), assumedHours: z.number().finite().min(0).max(100_000).nullable().optional(),
  time: timeOverrideSchema.optional(),
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
    ...(m.time ? { time: { textMessages: m.time.textMessages, audios: m.time.audios, audioMinutes: m.time.audioMinutes,
      unmeasuredAudios: m.time.unmeasuredAudios, longAudios: m.time.longAudios, longestAudioSeconds: m.time.longestAudioSeconds } } : {}),
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
    attended: { ...auto.attended, ...overrides.attended }, time: auto.time && { ...auto.time, ...overrides.time },
    procedures: [], missing: [],
  };
  // Tempo medido (áudio + mensagens) substitui a estimativa por conversa quando
  // o tempo por mensagem foi declarado; sem ele, vale a fórmula anterior. `!=`
  // porque snapshots antigos guardaram premissas sem a chave.
  const measured = config.secondsPerMessage != null && m.time ? returnedHours(m.time, config.secondsPerMessage) : null;
  m.assumedHours = overrides.assumedHours !== undefined ? overrides.assumedHours
    : measured ?? (config.minutesPerConversation == null ? null : m.aiOnlyConversations * config.minutesPerConversation / 60);
  m.savingsCents = m.assumedHours !== null && config.attendantMonthlyCents !== null && config.attendantMonthlyHours
    ? Math.round(m.assumedHours * config.attendantMonthlyCents / config.attendantMonthlyHours) : null;
  m.procedures = (overrides.procedures ?? auto.procedures).map((p) => {
    const premise = config.procedures.find((c) => normalizeLabel(c.name) === normalizeLabel(p.name));
    const revenueCents = p.attendedOutside === 0 ? 0 : premise?.ticketCents != null && premise.conversionBps != null
      ? Math.round(p.attendedOutside * premise.ticketCents * premise.conversionBps / 10_000) : null;
    return { ...p, revenueCents };
  });
  m.investmentCents = config.investmentCents;
  // Regra única do que falta (a central de pendências lê a mesma função).
  const pendencies = detectMonthlyPendencies(m, config);
  m.missing = pendencies.map((p) => p.text);
  m.revenueCents = blocksRevenue(pendencies) ? null : m.procedures.reduce((sum, p) => sum + (p.revenueCents ?? 0), 0);
  m.roiPercent = m.revenueCents !== null && m.savingsCents !== null && m.investmentCents !== null && m.investmentCents > 0
    ? Math.round((m.revenueCents + m.savingsCents - m.investmentCents) / m.investmentCents * 1000) / 10 : null;
  return m;
}
