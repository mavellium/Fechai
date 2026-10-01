import { z } from "zod";
import { monthRangeUtc, partsInZone, TIMEZONES, zonedTimeToUtc } from "@/modules/scheduling/time";

const nullableNumber = (max: number) => z.number().finite().min(0).max(max).nullable();
const period = z.object({ start: z.number().int().min(0).max(1439), end: z.number().int().min(1).max(1440) })
  .refine((p) => p.end > p.start, "O fim do expediente deve vir depois do início.");
export const monthlyAssumptionsSchema = z.object({
  // Ausente ou vazio = todos os agentes da conta (compatível com revisões antigas).
  agentIds: z.array(z.string().trim().min(1).max(100)).max(100)
    .refine((ids) => new Set(ids).size === ids.length, "Agente duplicado na seleção.").optional(),
  timezone: z.string().refine((v) => TIMEZONES.some((t) => t.value === v), "Fuso inválido."),
  // [] em um dia = fechado; null = horário ainda não levantado.
  humanHours: z.array(z.array(period).max(4)).length(7).nullable().refine((days) => !days || days.every((day) => {
    const sorted = [...day].sort((a, b) => a.start - b.start);
    return sorted.every((p, i) => i === 0 || p.start >= sorted[i - 1].end);
  }), "Há intervalos de atendimento sobrepostos."),
  // Datas locais em que a recepção fica fechada o dia inteiro. Não são os
  // bloqueios da agenda do agente. Ausente em revisões antigas = nenhuma exceção.
  humanClosedDates: z.array(z.iso.date({ error: "Informe os dias sem recepção como AAAA-MM-DD, com uma data válida por linha." })
    .regex(/^20\d{2}-/, "Informe uma data entre 2000 e 2099."))
    .max(366, "Informe até 366 dias sem recepção.")
    .refine((dates) => new Set(dates).size === dates.length, "Há dias sem recepção repetidos.").default([]),
  attendantMonthlyCents: nullableNumber(1_000_000_000).refine((v) => v === null || Number.isInteger(v)),
  attendantMonthlyHours: nullableNumber(744).refine((v) => v === null || v > 0, "Informe a carga mensal do atendente."),
  minutesPerConversation: nullableNumber(120).refine((v) => v === null || v > 0),
  // Leitura e resposta de cada mensagem que o agente respondeu. Preenchido,
  // substitui `minutesPerConversation` na economia. `default(null)` porque as
  // revisões salvas antes dele não têm a chave — sem isso a leitura falharia
  // e todas as premissas do mês voltariam vazias.
  secondsPerMessage: nullableNumber(600).refine((v) => v === null || v > 0, "Informe um tempo por mensagem maior que zero.").default(null),
  investmentCents: nullableNumber(1_000_000_000).refine((v) => v === null || Number.isInteger(v)),
  procedureVariable: z.string().trim().max(60).default("procedimento"),
  evaluationTypes: z.array(z.string().trim().min(1).max(100)).min(1).max(20),
  countUntypedAsEvaluations: z.boolean().default(false),
  // Type da API, explicitamente conferido pela Mavellium. CONFIRMED não é presença.
  completedStatusTypes: z.array(z.string().trim().min(1).max(80)).max(20)
    .refine((types) => !types.some((type) => type.toUpperCase() === "CONFIRMED"), "Confirmado não comprova avaliação realizada."),
  // Type que comprova a FALTA. Sem ele, consulta passada com status não mapeado
  // fica "não verificada", nunca falta. `default([])`: revisões salvas antes
  // não têm a chave (mesma lição de `secondsPerMessage`).
  noShowStatusTypes: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  procedures: z.array(z.object({
    name: z.string().trim().min(1).max(60),
    ticketCents: nullableNumber(1_000_000_000).refine((v) => v === null || Number.isInteger(v)),
    conversionBps: nullableNumber(10_000).refine((v) => v === null || Number.isInteger(v)),
  })).max(12).refine((rows) => new Set(rows.map((p) => normalizeLabel(p.name))).size === rows.length, "Procedimento duplicado."),
  // Retorno estimado (receita, economia, ROI) é opcional: só existe com ticket,
  // conversão e custo do atendente conferidos com a clínica. Ausente = revisão
  // anterior à chave; ver `financialEnabled`.
  financialEnabled: z.boolean().optional(),
});
export type MonthlyAssumptions = z.infer<typeof monthlyAssumptionsSchema>;
export const EMPTY_ASSUMPTIONS: MonthlyAssumptions = {
  timezone: "America/Sao_Paulo", humanHours: null, humanClosedDates: [], attendantMonthlyCents: null,
  attendantMonthlyHours: null, minutesPerConversation: null, secondsPerMessage: null, investmentCents: null,
  procedureVariable: "procedimento", evaluationTypes: ["Avaliação"], countUntypedAsEvaluations: false, completedStatusTypes: [], noShowStatusTypes: [], procedures: [],
};
/**
 * O relatório mede o que o Fechai controla (atendimento, agendamento,
 * comparecimento); o financeiro da clínica é opcional. Desligado, receita,
 * economia e ROI não são calculados, não aparecem e a falta de premissa
 * financeira não é pendência nem limitação.
 *
 * Revisão salva antes da chave (e snapshot já fechado): vale o que ela tinha —
 * ligado só se as premissas financeiras estavam completas, para o relatório
 * entregue com ROI continuar mostrando o ROI e o incompleto parar de mostrar
 * "pendente".
 */
export function financialEnabled(config: MonthlyAssumptions): boolean {
  return config.financialEnabled ?? (config.attendantMonthlyCents !== null && Boolean(config.attendantMonthlyHours)
    && config.procedures.length > 0 && config.procedures.every((p) => p.ticketCents !== null && p.conversionBps !== null));
}
export function parseMonthlyAssumptions(raw: unknown): MonthlyAssumptions {
  const result = monthlyAssumptionsSchema.safeParse(raw);
  return result.success ? result.data : { ...EMPTY_ASSUMPTIONS };
}
export function normalizeLabel(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("pt-BR").replace(/\s+/g, " ");
}
export function monthKey(raw?: string, now = new Date(), timezone = "America/Sao_Paulo") {
  if (raw && /^(20\d{2})-(0[1-9]|1[0-2])$/.test(raw)) return raw;
  const p = partsInZone(now, timezone);
  const previous = p.month === 1 ? { year: p.year - 1, month: 12 } : { year: p.year, month: p.month - 1 };
  return `${previous.year}-${String(previous.month).padStart(2, "0")}`;
}
export function monthlyWindow(month: string, timezone: string) {
  if (monthKey(month) !== month) throw new Error("Competência inválida.");
  const [year, m] = month.split("-").map(Number);
  const { start, end } = monthRangeUtc(year, m, timezone);
  const previousMonth = `${m === 1 ? year - 1 : year}-${String(m === 1 ? 12 : m - 1).padStart(2, "0")}`;
  const previous = monthRangeUtc(m === 1 ? year - 1 : year, m === 1 ? 12 : m - 1, timezone);
  const dueAt = zonedTimeToUtc(m === 12 ? year + 1 : year, m === 12 ? 1 : m + 1, 5, 0, 0, timezone);
  return { start, end, previous, previousMonth, dueAt };
}
export function outsideHumanHours(at: Date, config: MonthlyAssumptions): boolean | null {
  if (!config.humanHours) return null;
  if (isHumanClosedDay(at, config)) return true;
  const p = partsInZone(at, config.timezone);
  const minute = p.hour * 60 + p.minute;
  return !config.humanHours[p.weekday].some((h) => minute >= h.start && minute < h.end);
}

/** Data civil no fuso da clínica, nunca o dia UTC nem uma recorrência anual presumida. */
export function isHumanClosedDay(at: Date, config: Pick<MonthlyAssumptions, "timezone"> & Partial<Pick<MonthlyAssumptions, "humanClosedDates">>): boolean {
  if (!config.humanClosedDates?.length) return false;
  const p = partsInZone(at, config.timezone);
  const day = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  return config.humanClosedDates.includes(day);
}

/** Mantém entrada inválida para a validação apontar o erro, sem descartar datas em silêncio. */
export const humanClosedDatesFromText = (text: string): string[] => text.split(/\r?\n/).map((day) => day.trim()).filter(Boolean);
