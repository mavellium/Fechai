import type { MonthlyAssumptions } from "./monthly-config";
import type { MetricStatus, MonthlyProblem, MonthlyReportData } from "./monthly-data";

/*
 * Como o relatório mensal v2 ESCREVE os números. Nada aqui calcula: recebe o
 * que `MonthlyReportData` já traz e devolve texto, igual no painel e no PDF.
 * Os textos fixos (frase de abertura, problemas) saem daqui para que nenhum
 * número chegue ao decisor sem ter vindo do motor.
 */

/** 38 s · 22 min · 6min12 · 2h05 · 9h40 · 3h */
export function formatSpan(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total} s`;
  if (total < 3600) {
    const m = Math.floor(total / 60), s = total % 60;
    return s ? `${m}min${String(s).padStart(2, "0")}` : `${m} min`;
  }
  const minutes = Math.round(total / 60);
  return minutes % 60 ? `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}` : `${minutes / 60}h`;
}

export const formatCount = (n: number | null | undefined) => n == null ? "—" : n.toLocaleString("pt-BR");
export const formatPercent = (n: number | null | undefined) => n == null ? "—" : `${n.toLocaleString("pt-BR")}%`;
/** Reais inteiros: o relatório fala em "R$ 8.960", não em centavos. */
export const formatReais = (cents: number) => `R$ ${Math.round(cents / 100).toLocaleString("pt-BR")}`;

/** Só o que o decisor precisa saber sobre a confiança do número; medido e confirmado não levam selo. */
export const STATUS_SEAL: Partial<Record<MetricStatus, string>> = { estimated: "estimativa", partial: "parcial", unverified: "não verificado" };

const DAY = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const hour = (minute: number) => minute % 60 ? `${Math.floor(minute / 60)}h${String(minute % 60).padStart(2, "0")}` : `${minute / 60}h`;

/** "seg a sex 8h–18h, sáb 8h–12h": dias seguidos com o mesmo horário viram um intervalo. */
export function hoursLabel(humanHours: MonthlyAssumptions["humanHours"]): string | null {
  if (!humanHours) return null;
  const text = humanHours.map((day) => day.map((p) => `${hour(p.start)}–${hour(p.end)}`).join(" e "));
  const groups: { from: number; to: number; text: string }[] = [];
  // De segunda a domingo, como a clínica fala do próprio expediente.
  for (const day of [1, 2, 3, 4, 5, 6, 0]) {
    if (!text[day]) continue;
    const last = groups.at(-1);
    if (last && last.text === text[day] && last.to === day - 1) last.to = day;
    else groups.push({ from: day, to: day, text: text[day] });
  }
  if (!groups.length) return null;
  return groups.map((g) => `${g.from === g.to ? DAY[g.from] : `${DAY[g.from]} a ${DAY[g.to]}`} ${g.text}`).join(", ");
}

const plural = (n: number, one: string, many: string) => `${formatCount(n)} ${n === 1 ? one : many}`;

/**
 * A frase que abre o relatório. Texto fixo, montado dos números do motor: o
 * decisor lê primeiro o que o Fechai fez, sem depender de redação.
 */
export function openingSentence(monthName: string, data: MonthlyReportData): string {
  const contacts = data.service.contacts, cohort = data.schedule.cohort;
  const parts = [`Em ${monthName}, o Fechai atendeu ${plural(contacts.total.value ?? 0, "contato", "contatos")} e marcou ${plural(cohort.total.total.value ?? 0, "avaliação", "avaliações")}.`];
  const attended = cohort.attended.total.value ?? 0;
  if (attended > 0) parts.push(`${plural(attended, "paciente já compareceu", "pacientes já compareceram")}.`);
  const outside = contacts.outside.value;
  if (outside) parts.push(`${plural(outside, "contato chegou", "contatos chegaram")} com a recepção fechada e ${outside === 1 ? "foi atendido" : "foram atendidos"} do mesmo jeito.`);
  return parts.join(" ");
}

/** Um problema comprovado nos dados, em uma frase de destaque e outra de detalhe. */
export function problemText(problem: MonthlyProblem, timezone: string): { title: string; detail: string } {
  if (problem.kind === "no_show") {
    return { title: `${plural(problem.count, "falta", "faltas")}${problem.ratePercent === null ? "" : ` (${problem.ratePercent}% das consultas já realizadas).`}`,
      detail: "Pacientes que marcaram a avaliação com o agente e não compareceram." };
  }
  if (problem.kind === "outage") {
    const day = new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, day: "2-digit", month: "2-digit" });
    const clock = new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, hour: "numeric", minute: "2-digit", hourCycle: "h23" });
    // "19h" e "19h30", como a clínica fala.
    const time = { format: (at: Date) => clock.format(at).replace(":", "h").replace(/h00$/, "h") };
    const from = new Date(problem.startsAt), to = new Date(problem.endsAt);
    return { title: `O agente ficou ${formatSpan(problem.minutes * 60)} fora do ar em ${day.format(from)}, das ${time.format(from)} às ${time.format(to)}.`,
      detail: problem.contactsAffected ? `${plural(problem.contactsAffected, "contato esperou", "contatos esperaram")} até o agente voltar.` : problem.description };
  }
  const waited = problem.waitedOverHour ? `${plural(problem.waitedOverHour, "conversa passada para a recepção esperou", "conversas passadas para a recepção esperaram")} mais de 1 hora` : "";
  const open = problem.unanswered ? `${plural(problem.unanswered, "seguia", "seguiam")} sem resposta no fim do mês` : "";
  return { title: `${waited}${waited && open ? ", e " : ""}${open}.`.replace(/^./, (c) => c.toUpperCase()), detail: "O tempo de resposta da recepção é contado à parte do tempo do agente." };
}

export const NO_PROBLEMS = "Nenhum incidente relevante identificado neste mês.";

/** "01/09 a 30/09" */
export function periodLabel(month: string): string {
  const [year, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return `01/${mm} a ${last}/${mm}`;
}

/** Variação contra o mês anterior, com sinal: "+25 vs. agosto". */
export function deltaLabel(current: number | null, previous: number | null | undefined, previousName: string): string | null {
  if (current === null || previous == null) return null;
  const diff = current - previous;
  return diff === 0 ? `igual a ${previousName}` : `${diff > 0 ? "+" : "−"}${formatCount(Math.abs(diff))} vs. ${previousName}`;
}
