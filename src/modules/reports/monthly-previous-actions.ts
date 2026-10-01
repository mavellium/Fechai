import { z } from "zod";
import { normalizeLabel } from "./monthly-config";
import type { MonthlyNextAction } from "./monthly-next-actions";

/*
 * Ações do mês anterior, no topo de "O que ajustamos no agente": cada ação
 * combinada no relatório anterior volta neste com o que aconteceu — funcionou,
 * parcial ou não funcionou — e o número que comprova.
 *
 * As ações não são digitadas de novo: vêm das próximas ações do relatório
 * anterior já aprovado (o snapshot). A revisão deste mês só acrescenta o status
 * e o resultado. Fechar exige os dois em cada ação: promessa sem prestação de
 * contas é o que o decisor cobra na reunião. Puro.
 */

export const ACTION_STATUSES = ["worked", "partial", "failed"] as const;
export type ActionStatus = typeof ACTION_STATUSES[number];
export const ACTION_STATUS_LABEL: Record<ActionStatus, string> = { worked: "Funcionou", partial: "Parcial", failed: "Não funcionou" };
export const ACTION_RESULT_MAX = 160;

export const previousActionSchema = z.object({
  action: z.string().trim().min(1).max(120),
  owner: z.string().trim().max(60).default(""),
  indicator: z.string().trim().max(100).default(""),
  status: z.enum(ACTION_STATUSES).nullable().default(null),
  /** O número que comprova: "faltas caíram de 31% para 22%". */
  result: z.string().trim().max(ACTION_RESULT_MAX).default(""),
}).strict();
export const previousActionsSchema = z.array(previousActionSchema).max(3);
export type PreviousAction = z.infer<typeof previousActionSchema>;

/** Nunca lança: a coluna pode estar vazia, antiga ou editada à mão. */
export function parsePreviousActions(raw: unknown): PreviousAction[] {
  const parsed = previousActionsSchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}

/**
 * As ações do relatório anterior com a avaliação já salva neste mês. A lista é
 * sempre a do plano aprovado: avaliação de uma ação que não está mais nele
 * (o relatório anterior foi reaberto e mudou) é descartada.
 */
export function reviewPreviousActions(plan: MonthlyNextAction[], saved: PreviousAction[]): PreviousAction[] {
  return plan.map((item) => {
    const kept = saved.find((s) => normalizeLabel(s.action) === normalizeLabel(item.action));
    return { action: item.action, owner: item.owner, indicator: item.indicator, status: kept?.status ?? null, result: kept?.result ?? "" };
  });
}

/** O que falta para fechar, ou `null`. Sem ações no mês anterior não falta nada. */
export function previousActionsProblem(list: PreviousAction[] | undefined): string | null {
  const open = (list ?? []).filter((a) => !a.status || !a.result.trim()).length;
  if (!open) return null;
  return `Avalie ${open === 1 ? "a ação combinada" : `as ${open} ações combinadas`} no mês anterior: status e o número que comprova.`;
}
