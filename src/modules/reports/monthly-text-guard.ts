import type { MonthlyReportData } from "./monthly-data";
import { formatCount, formatReais, formatSpan } from "./monthly-format";

/*
 * Guardas dos textos que vão ao decisor (relatório v2). A IA só redige: todo
 * número que ela escrever precisa existir em `MonthlyReportData`, em qualquer
 * das formas em que o relatório o mostra ("9h40", "78%", "R$ 8.960"). Número
 * sem origem é recusado, porque foi exatamente texto e cálculo divergentes que
 * motivaram esta versão.
 *
 * Puro. A recusa de nome, telefone e e-mail continua em `reviewTextProblem`.
 */

const TOKEN = /\d+h\d{2}|\d+min\d{2}|\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?/g;
const tokens = (text: string) => text.match(TOKEN) ?? [];
/** "1.180" e "1180" são o mesmo número; "9h40" e "5,2" ficam como estão. */
const canonical = (token: string) => /^\d{1,3}(\.\d{3})+/.test(token) ? token.replace(/\./g, "") : token;

function numbersIn(value: unknown, out: number[] = []): number[] {
  if (typeof value === "number" && Number.isFinite(value)) out.push(value);
  else if (Array.isArray(value)) for (const item of value) numbersIn(item, out);
  else if (value && typeof value === "object") for (const item of Object.values(value)) numbersIn(item, out);
  return out;
}

/** Todas as formas em que um número do motor pode aparecer no texto. */
export function allowedNumbers(data: MonthlyReportData, context: { month: string; previousMonth?: string }): Set<string> {
  const allowed = new Set<string>();
  const add = (text: string) => { for (const token of tokens(text)) allowed.add(canonical(token)); };
  const numbers = numbersIn(data);
  for (const n of numbers) {
    add(formatCount(n)); add(String(n).replace(".", ",")); add(formatSpan(n)); add(formatReais(n));
    // Segundos também são ditos em minutos ("22 minutos") e em horas inteiras.
    if (n >= 60 && n % 60 === 0) add(String(n / 60));
    if (n >= 3600 && n % 3600 === 0) add(String(n / 3600));
  }
  // Complemento de percentual ("22% de faltas" a partir de 78% de comparecimento) e variação contra o mês anterior.
  const rate = data.schedule.attendanceRatePercent.value;
  if (rate !== null) add(String(100 - rate));
  const c = data.comparison;
  if (c) for (const [now, before] of [[data.service.contacts.total.value, c.contacts], [data.schedule.cohort.total.total.value, c.scheduled], [data.unanswered.value, c.unanswered]] as const) {
    if (now !== null) add(formatCount(Math.abs(now - before)));
  }
  // Datas do período e o que é vocabulário, não medida ("24h por dia").
  for (const part of [...context.month.split("-"), ...(context.previousMonth?.split("-") ?? [])]) { add(part); add(String(Number(part))); }
  add("24"); add("100");
  return allowed;
}

/** Números do texto que o motor não calculou. 0, 1 e 2 passam: são linguagem ("1 hora", "as 2 partes"). */
export function unknownNumbers(text: string, allowed: Set<string>): string[] {
  const found = new Set<string>();
  for (const token of tokens(text)) {
    const key = canonical(token);
    if (["0", "1", "2"].includes(key) || allowed.has(key)) continue;
    found.add(token);
  }
  return [...found];
}

/** Data completa (12/09, 12/09/2026, 12 de setembro): o caso do mês e o resumo nunca dizem o dia exato de um paciente. */
const FULL_DATE = /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b|\b\d{1,2}\s+de\s+(?:janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/i;
export const hasFullDate = (text: string) => FULL_DATE.test(text);
