import { z } from "zod";

/*
 * "Próximas ações" da página 1 do relatório: até três prioridades aprovadas
 * pela Mavellium, cada uma com responsável e indicador de acompanhamento.
 * Substitui o texto livre `nextMonth`, que continua sendo lido só para os
 * relatórios salvos antes (sem ações, o painel e o PDF mostram o texto).
 *
 * Responsável é uma área ou função ("Recepção", "Mavellium"), nunca paciente;
 * o indicador é algo que o próximo relatório consegue medir.
 */

export const NEXT_ACTIONS_MAX = 3;
export const nextActionSchema = z.object({
  action: z.string().trim().min(1, "Descreva cada ação.").max(120),
  owner: z.string().trim().min(1, "Informe o responsável de cada ação.").max(60),
  indicator: z.string().trim().min(1, "Informe o indicador de cada ação.").max(100),
}).strict();
export const nextActionsSchema = z.array(nextActionSchema).max(NEXT_ACTIONS_MAX, `Use no máximo ${NEXT_ACTIONS_MAX} ações.`);
export type MonthlyNextAction = z.infer<typeof nextActionSchema>;

/** Nunca lança: a coluna pode estar vazia, antiga ou editada à mão. */
export function parseNextActions(raw: unknown): MonthlyNextAction[] {
  const parsed = nextActionsSchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}

/** Tem plano para o mês seguinte: ações novas ou o texto dos relatórios antigos. */
export const hasNextPlan = (r: { nextActions?: MonthlyNextAction[]; nextMonth: string }) => Boolean(r.nextActions?.length || r.nextMonth.trim());
