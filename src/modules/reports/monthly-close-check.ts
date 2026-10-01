import { decisionMakerProblem } from "./monthly-decision-maker";
import { hasNextPlan } from "./monthly-next-actions";
import { previousActionsProblem } from "./monthly-previous-actions";
import type { MonthlyReport } from "./monthly";

/** Requisitos editoriais; cobertura parcial não substitui a revisão da etapa 4. */
export function monthlyCloseProblems(report: MonthlyReport, owners: string[]): string[] {
  const problems: string[] = [];
  const decisor = decisionMakerProblem(report, owners);
  if (decisor) problems.push(decisor);
  if (!report.adjustments.trim() && !report.agentChanges?.length) problems.push("Descreva o que foi ajustado no agente. Se não houve ajustes, registre isso explicitamente.");
  if (!hasNextPlan(report)) problems.push("Preencha ao menos uma próxima ação, com responsável e indicador.");
  const previous = previousActionsProblem(report.previousActions);
  if (previous) problems.push(previous);
  return problems;
}
