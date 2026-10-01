import { normalizeLabel } from "./monthly-config";
import type { MonthlyReport } from "./monthly";
import type { MonthlyReportData, Split } from "./monthly-data";
import { allowedNumbers, hasFullDate, unknownNumbers } from "./monthly-text-guard";

/*
 * Validador do relatório mensal v2. Roda ao salvar, antes da redação da IA e
 * no fechamento. `blocking` impede fechar: é número que não fecha ou decisor
 * errado, coisas que o decisor da clínica veria. `warning` não bloqueia: o
 * número sai com o status que tem (parcial, não verificado) e a central de
 * pendências mostra o que fazer.
 *
 * Falta de ticket, conversão ou custo da equipe NÃO é problema: só desliga o
 * bloco de retorno estimado.
 */

export type IssueSeverity = "blocking" | "warning";
export type MonthlyIssue = { key: string; severity: IssueSeverity; metric: string; message: string; action: string };

/** Acima disto, a mediana do agente provavelmente mistura resposta humana ou fila parada. */
export const SLOW_AGENT_SECONDS = 300;
/** Abaixo disto de contatos com cidade informada, a leitura de área é parcial. */
export const MIN_CITY_COVERAGE = 0.5;

type Texts = Pick<MonthlyReport, "decisionMaker" | "operationalContact"> & Partial<Pick<MonthlyReport, "highlights" | "featuredCase" | "month" | "previousMonth">>;

const splitBroken = (s: Split) => s.inside.value !== null && s.outside.value !== null
  && s.inside.value + s.outside.value + s.unclassified !== s.total.value;

export function validateMonthlyReport(data: MonthlyReportData, texts: Texts): MonthlyIssue[] {
  const issues: MonthlyIssue[] = [];
  const add = (severity: IssueSeverity, key: string, metric: string, message: string, action: string) => issues.push({ key, severity, metric, message, action });
  const s = data.service, a = data.schedule;
  const contacts = s.contacts.total.value ?? 0, scheduled = a.cohort.total.total.value ?? 0;

  /* ------------------------------ Bloqueantes ------------------------------ */
  if ((s.aiOnly.value ?? 0) + (s.transferred.value ?? 0) !== contacts) {
    add("blocking", "service_sum", "Contatos atendidos", `Só o agente (${s.aiOnly.value}) + passadas para a recepção (${s.transferred.value}) não somam os ${contacts} contatos.`, "Reimporte os dados; se persistir, avise o desenvolvimento.");
  }
  const c = a.cohort;
  const cohortSum = (c.attended.total.value ?? 0) + (c.no_show.total.value ?? 0) + (c.upcoming.total.value ?? 0) + (c.unverified.total.value ?? 0);
  if (cohortSum !== scheduled) {
    add("blocking", "cohort_sum", "Avaliações agendadas", `Compareceram + faltaram + aguardando + não verificado (${cohortSum}) não somam as ${scheduled} agendadas.`, "Reimporte os dados; se persistir, avise o desenvolvimento.");
  }
  const splits: [string, Split][] = [["Contatos atendidos", s.contacts], ["Qualificados", a.qualified], ["Compareceram", c.attended],
    ["Faltaram", c.no_show], ["Aguardando consulta", c.upcoming], ["Comparecimento não verificado", c.unverified], ["Avaliações agendadas", c.total]];
  for (const [label, split] of splits) if (splitBroken(split)) {
    add("blocking", "split_sum", label, `${label}: expediente + fora não somam o total.`, "Reimporte os dados; se persistir, avise o desenvolvimento.");
  }
  const reasons = data.leads.reasons.reduce((n, r) => n + r.contacts, 0);
  if (reasons !== contacts - a.scheduledContacts) {
    add("blocking", "reasons_sum", "Motivo de não agendar", `Os motivos somam ${reasons}, mas ${contacts - a.scheduledContacts} contatos não agendaram.`, "Reimporte os dados; se persistir, avise o desenvolvimento.");
  }
  const decisionMaker = texts.decisionMaker.trim(), operational = (texts.operationalContact ?? "").trim();
  if (!decisionMaker) {
    add("blocking", "decision_maker", "Decisor", "Decisor não informado.", "Informe o dono ou sócio que recebe o relatório.");
  } else if (operational && normalizeLabel(decisionMaker) === normalizeLabel(operational)) {
    add("blocking", "decision_maker", "Decisor", "O decisor é a mesma pessoa do contato operacional.", "O decisor é o dono ou sócio; a recepção entra como contato operacional, em cópia.");
  }

  // O resumo do período é rascunho da IA: número que o motor não calculou não chega ao decisor.
  if (texts.highlights && texts.month) {
    const unknown = unknownNumbers(texts.highlights, allowedNumbers(data, { month: texts.month, previousMonth: texts.previousMonth }));
    if (unknown.length) add("blocking", "text_numbers", "Resumo do período", `O resumo cita ${unknown.length === 1 ? "um número" : "números"} que não está${unknown.length === 1 ? "" : "ão"} nos dados do mês: ${unknown.join(", ")}.`, "Corrija o texto na etapa 4 ou gere a análise de novo.");
  }
  for (const [label, text] of [["Caso do mês", texts.featuredCase], ["Resumo do período", texts.highlights]] as const) {
    if (text && hasFullDate(text)) add("blocking", "text_date", label, `${label} cita uma data completa.`, "Diga só o dia da semana e o período (manhã, tarde, noite).");
  }

  /* -------------------------------- Avisos -------------------------------- */
  if (!data.meta.hoursConfigured) {
    add("warning", "hours", "Expediente", "Expediente da clínica não cadastrado: os números saem só com o total, sem a quebra.", "Confirme o expediente na etapa 2.");
  }
  if (a.qualified.total.status === "partial") {
    add("warning", "qualification", "Qualificados", `${a.qualified.total.value} qualificados para ${scheduled} avaliações agendadas: o agente não está registrando a qualificação.`, "Revise a regra de qualificação do agente.");
  }
  const transferred = s.transferred.value ?? 0, events = s.handoffEvents.value ?? 0;
  if (transferred > 0 && events === 0) {
    add("warning", "handoff", "Passadas para a recepção", `${transferred} conversas tiveram resposta da equipe e o agente não registrou nenhum transbordo.`, "Confira se a ação de transferir para humano está ligada e quando a equipe assume.");
  }
  if ((s.reception.unanswered.value ?? 0) > 0) {
    add("warning", "reception", "Recepção", `${s.reception.unanswered.value} conversas passadas para a recepção seguiam sem resposta no fim do mês.`, "Avise a clínica: é a seção \"o que não saiu como planejado\".");
  }
  if ((s.agentFirstResponseSeconds.value ?? 0) > SLOW_AGENT_SECONDS) {
    add("warning", "agent_response", "1ª resposta do agente", `Mediana de ${s.agentFirstResponseSeconds.value} s na primeira resposta do agente.`, "Investigue atraso da fila ou agente pausado.");
  }
  if (data.leads.withCity.status === "partial") {
    add("warning", "city", "Qualidade dos leads", `Só ${data.leads.withCity.value} de ${contacts} contatos informaram a cidade.`, "Ajuste o agente para perguntar a cidade.");
  }
  if ((c.unverified.total.value ?? 0) > 0) {
    add("warning", "attendance", "Compareceram", `${c.unverified.total.value} avaliação(ões) com data passada e sem comparecimento confirmado.`, "Mapeie os status do Clinicorp ou marque o comparecimento na agenda.");
  }
  if (splits.some(([, split]) => split.unclassified > 0)) {
    add("warning", "arrival", "Expediente", "Há registros sem horário de chegada do contato, fora da quebra por expediente.", "Confira os registros sem classificação.");
  }
  return issues;
}

export const blockingIssues = (issues: MonthlyIssue[]) => issues.filter((i) => i.severity === "blocking");
