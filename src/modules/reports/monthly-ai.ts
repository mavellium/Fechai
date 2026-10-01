import { z } from "zod";
import { formatBRL } from "@/lib/format";
import { monthlyAssumptionsSchema, normalizeLabel } from "./monthly-config";
import { monthlyMetricOverrideSchema, monthlyOverridesSchema, timeOverrideSchema } from "./monthly-overrides";
import { HIGHLIGHTS_MAX, LIMITATIONS_NOTE_MAX } from "./monthly-limitations";
import { nextActionsSchema } from "./monthly-next-actions";

export const monthlyAiDraftSchema = z.object({
  assumptions: monthlyAssumptionsSchema,
  metricOverrides: monthlyOverridesSchema,
  adjustments: z.string().max(400), nextMonth: z.string().max(400), decisionMaker: z.string().max(100),
  // `default` porque o painel lateral antigo mandava o rascunho sem os dois.
  highlights: z.string().max(HIGHLIGHTS_MAX).default(""), limitationsNote: z.string().max(LIMITATIONS_NOTE_MAX).default(""),
  nextActions: nextActionsSchema.default([]),
}).strict();
export type MonthlyAiDraft = z.infer<typeof monthlyAiDraftSchema>;
/** Validação legível também antes de a chamada à IA chegar ao servidor. */
export function monthlyDraftProblem(issues: { path: PropertyKey[]; message: string }[]): string {
  const labels: Record<string, string> = {
    evaluationTypes: "Tipos de atendimento considerados avaliações (etapa 2)", humanHours: "Expediente humano (etapa 2)",
    humanClosedDates: "Feriados e dias sem recepção (etapa 2)", procedures: "Procedimentos, ticket e conversão (etapa 2)",
    attendantMonthlyHours: "Carga mensal do atendente (etapa 2)", attendantMonthlyCents: "Custo mensal do atendente (etapa 2)",
    investmentCents: "Mensalidade (etapa 2)", secondsPerMessage: "Tempo por mensagem (etapa 2)", minutesPerConversation: "Tempo por conversa (etapa 2)",
    completedStatusTypes: "Status de comparecimento (etapa 2)", noShowStatusTypes: "Status de falta (etapa 2)",
    timezone: "Fuso da clínica (etapa 2)", agentIds: "Agentes (etapa 1)", procedureVariable: "Variável do procedimento (etapa 2)",
    metricOverrides: "Indicadores corrigidos (etapa 1)", adjustments: "Ajustes no agente (etapa 4)", nextActions: "Próximas ações (etapa 4)",
    nextMonth: "Plano do próximo mês (etapa 4)", decisionMaker: "Decisor (etapa 4)", highlights: "Resumo do período (etapa 4)", limitationsNote: "O que não saiu como planejado (etapa 4)",
  };
  const fields = [...new Set(issues.map((issue) => String(issue.path[0] === "assumptions" ? issue.path[1] : issue.path[0])))];
  return `Confira: ${fields.map((key) => labels[key] ?? "dados da revisão").join("; ")}.`;
}
export const monthlyAiRequestSchema = z.object({
  question: z.string().trim().min(1, "Escreva uma pergunta para a IA.").max(2000),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(5000) }).strict()).max(12),
  draft: monthlyAiDraftSchema,
}).strict();
export type MonthlyAiRequest = z.infer<typeof monthlyAiRequestSchema>;

const procedurePatch = z.array(z.object({ name: z.string().trim().min(1).max(60),
  ticketCents: monthlyAssumptionsSchema.shape.procedures.element.shape.ticketCents.optional(),
  conversionBps: monthlyAssumptionsSchema.shape.procedures.element.shape.conversionBps.optional(),
}).strict()).min(1).max(12).refine((rows) => new Set(rows.map((p) => normalizeLabel(p.name))).size === rows.length, "Procedimento duplicado.");

// Somente campos editáveis. A IA não confirma presença, expediente, escopo ou fechamento.
const fields: Record<string, z.ZodType> = {
  "assumptions.timezone": monthlyAssumptionsSchema.shape.timezone,
  "assumptions.humanHours": monthlyAssumptionsSchema.shape.humanHours,
  "assumptions.investmentCents": monthlyAssumptionsSchema.shape.investmentCents,
  "assumptions.attendantMonthlyCents": monthlyAssumptionsSchema.shape.attendantMonthlyCents,
  "assumptions.attendantMonthlyHours": monthlyAssumptionsSchema.shape.attendantMonthlyHours,
  "assumptions.minutesPerConversation": monthlyAssumptionsSchema.shape.minutesPerConversation,
  "assumptions.secondsPerMessage": monthlyAssumptionsSchema.shape.secondsPerMessage,
  "assumptions.procedureVariable": monthlyAssumptionsSchema.shape.procedureVariable,
  "assumptions.evaluationTypes": monthlyAssumptionsSchema.shape.evaluationTypes,
  "assumptions.procedures": procedurePatch,
  adjustments: monthlyAiDraftSchema.shape.adjustments, nextMonth: monthlyAiDraftSchema.shape.nextMonth,
  decisionMaker: monthlyAiDraftSchema.shape.decisionMaker,
  highlights: z.string().max(HIGHLIGHTS_MAX), limitationsNote: z.string().max(LIMITATIONS_NOTE_MAX),
  nextActions: nextActionsSchema,
};
for (const period of ["current", "previous"]) {
  for (const [key, schema] of Object.entries(monthlyMetricOverrideSchema.shape)) {
    if (["conversations", "scheduled", "attended"].includes(key)) {
      for (const part of ["inside", "outside", "unclassified"]) fields[`${period}.${key}.${part}`] = z.number().int().min(0).max(10_000_000);
    } else if (key === "time") {
      for (const [part, partSchema] of Object.entries(timeOverrideSchema.shape)) fields[`${period}.time.${part}`] = partSchema;
    } else fields[`${period}.${key}`] = schema;
  }
}
/**
 * Ação que a IA propõe e só acontece com confirmação humana. Hoje, uma: a
 * lista de agendamentos para conferir com a recepção, montada pelo servidor.
 */
export const monthlyAiProposalSchema = z.object({
  kind: z.literal("review_list"),
  title: z.string().trim().min(1).max(120),
  question: z.string().trim().min(1).max(240),
  appointmentIds: z.array(z.string().trim().min(1).max(100)).min(1).max(100),
}).strict();
export type MonthlyAiProposal = z.infer<typeof monthlyAiProposalSchema>;

export const monthlyAiResponseSchema = z.object({
  reply: z.string().trim().min(1).max(5000),
  proposal: monthlyAiProposalSchema.nullable().optional(),
  changes: z.array(z.object({ field: z.string(), value: z.unknown(), reason: z.string().trim().min(1).max(240) }).strict()).max(30)
    .superRefine((changes, ctx) => {
      const used = new Set<string>();
      changes.forEach((change, index) => {
        const schema = Object.hasOwn(fields, change.field) ? fields[change.field] : undefined;
        if (!schema || change.value === undefined || !schema.safeParse(change.value).success || used.has(change.field)) {
          ctx.addIssue({ code: "custom", path: [index], message: "A IA sugeriu um campo ou valor inválido." });
        }
        used.add(change.field);
      });
    }),
}).strict();
export type MonthlyAiResponse = z.infer<typeof monthlyAiResponseSchema>;
export type MonthlyAiChange = MonthlyAiResponse["changes"][number];

export function parseMonthlyAiResponse(content: string): MonthlyAiResponse {
  if (content.length > 60_000) throw new Error("Resposta da IA muito extensa.");
  const text = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return monthlyAiResponseSchema.parse(JSON.parse(text));
}

export function applyMonthlyAiChanges(draft: MonthlyAiDraft, changes: MonthlyAiChange[]): MonthlyAiDraft {
  monthlyAiResponseSchema.parse({ reply: "Aplicar", changes });
  const next = structuredClone(draft);
  for (const change of changes) {
    const [group, key, child] = change.field.split(".");
    if (change.field === "assumptions.procedures") {
      for (const patch of procedurePatch.parse(change.value)) {
        const existing = next.assumptions.procedures.find((p) => normalizeLabel(p.name) === normalizeLabel(patch.name));
        if (existing) Object.assign(existing, patch);
        else next.assumptions.procedures.push({ ticketCents: null, conversionBps: null, ...patch });
      }
    } else if (group === "assumptions") {
      Object.assign(next.assumptions, { [key]: change.value });
    } else if (group === "current" || group === "previous") {
      const values = next.metricOverrides[group] as Record<string, unknown>;
      values[key] = child ? { ...(values[key] as Record<string, unknown> ?? {}), [child]: change.value } : change.value;
    } else Object.assign(next, { [group]: change.value });
  }
  return monthlyAiDraftSchema.parse(next);
}

const names: Record<string, string> = {
  timezone: "Fuso", humanHours: "Expediente humano", investmentCents: "Mensalidade do Fechai",
  attendantMonthlyCents: "Custo mensal do atendente", attendantMonthlyHours: "Carga mensal do atendente",
  minutesPerConversation: "Tempo humano por conversa", procedureVariable: "Variável do procedimento",
  evaluationTypes: "Tipos considerados avaliações", procedures: "Procedimentos", peaks: "Horários de pico",
  adjustments: "O que ajustamos no agente", nextMonth: "Próximo mês", decisionMaker: "Nome do decisor",
  highlights: "Resumo do período", limitationsNote: "Limitações do fechamento", nextActions: "Próximas ações",
  newContacts: "Novos contatos", firstResponseSeconds: "Primeira resposta média", qualified: "Leads qualificados",
  handoffs: "Transbordos", unanswered: "Perguntas sem resposta", aiOnlyConversations: "Conversas sem resposta humana",
  assumedHours: "Horas assumidas", conversations: "Conversas atendidas", scheduled: "Avaliações agendadas",
  attended: "Avaliações realizadas", attendanceUnknown: "Presenças pendentes", untypedAppointments: "Agendamentos sem tipo",
  inside: "dentro do horário", outside: "fora do horário", unclassified: "sem classificação",
  secondsPerMessage: "Tempo por mensagem", time: "Tempo devolvido", textMessages: "Mensagens de texto respondidas",
  audios: "Áudios ouvidos", audioMinutes: "Minutos de áudio", unmeasuredAudios: "Áudios sem duração medida",
  longAudios: "Áudios acima de 2 min", longestAudioSeconds: "Maior áudio",
};
export function describeMonthlyAiChange(change: MonthlyAiChange): { label: string; value: string } {
  const parts = change.field.split(".");
  const label = parts.map((p) => p === "assumptions" ? "" : p === "current" ? "Este mês" : p === "previous" ? "Mês anterior" : names[p] ?? p).filter(Boolean).join(" · ");
  const key = parts.at(-1)!;
  let value = change.value === null ? "Pendente" : String(change.value);
  if (key.endsWith("Cents") && typeof change.value === "number") value = formatBRL(change.value);
  else if (change.field === "assumptions.procedures") value = procedurePatch.parse(change.value).map((p) => `${p.name}${p.ticketCents !== undefined ? ` · ticket ${p.ticketCents === null ? "pendente" : formatBRL(p.ticketCents)}` : ""}${p.conversionBps !== undefined ? ` · conversão ${p.conversionBps === null ? "pendente" : `${p.conversionBps / 100}%`}` : ""}`).join("\n");
  else if (key === "humanHours" && Array.isArray(change.value)) value = change.value.map((day: { start: number; end: number }[], i: number) => `${["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"][i]}: ${day.map((p) => `${time(p.start)}–${time(p.end)}`).join(", ") || "fechado"}`).join("; ");
  else if (key === "evaluationTypes" && Array.isArray(change.value)) value = change.value.join(", ");
  else if (key === "nextActions" && Array.isArray(change.value)) value = change.value.map((a: { action: string; owner: string; indicator: string }, i: number) => `${i + 1}. ${a.action} · ${a.owner} · ${a.indicator}`).join("\n");
  else if (key === "procedures" && Array.isArray(change.value)) value = change.value.map((p: { name: string; qualified: number; attendedOutside: number }) => `${p.name}: ${p.qualified} qualificados, ${p.attendedOutside} realizadas fora`).join("\n");
  else if (key === "peaks" && Array.isArray(change.value)) value = change.value.map((p: { hour: number; messages: number }) => `${p.hour}h: ${p.messages} mensagens`).join(", ");
  else if (typeof change.value === "number") value = `${change.value.toLocaleString("pt-BR")}${key === "attendantMonthlyHours" || key === "assumedHours" ? " h" : key === "minutesPerConversation" || key === "audioMinutes" ? " min" : ["firstResponseSeconds", "secondsPerMessage", "longestAudioSeconds"].includes(key) ? " s" : ""}`;
  return { label, value };
}
function time(minute: number) { return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`; }

export function monthlyAiFieldContract() {
  return Object.fromEntries(Object.entries(fields).map(([name, schema]) => [name, z.toJSONSchema(schema)]));
}
