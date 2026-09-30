import { dayKeyInZone, partsInZone, timeInZone } from "@/modules/scheduling/time";

/**
 * Data e hora de agora para o LLM, e o aviso de que o histórico pode ser de
 * outro dia.
 *
 * O bug que motivou isto: o lembrete da véspera ("consulta amanhã às 10:45",
 * 20h24) fica no histórico como mensagem do agente. Na manhã seguinte a
 * paciente respondeu e o agente repetiu "te esperamos amanhã às 10:45" — duas
 * vezes — com a consulta sendo naquele dia. A data de hoje já ia no prompt
 * (quando o agendamento está ligado) e a consulta já ia com data absoluta; o
 * que faltava era dizer que aquela mensagem do histórico foi escrita ONTEM, e
 * que "hoje"/"amanhã" não se copia de mensagem antiga nem dos exemplos da
 * persona (a da clínica tinha "Te esperamos amanhã às 10h" como modelo a
 * repetir).
 *
 * O aviso vai no system prompt, não como mensagem no meio do histórico: o
 * Gemini junta toda mensagem `system` num bloco só e o marcador perderia a
 * posição. Também não se prefixa a data no conteúdo das mensagens do agente:
 * o modelo tende a imitar o prefixo nas próprias respostas. E texto do contato
 * nunca é citado aqui — seria elevar texto não confiável a instrução de
 * sistema (ver `INJECTION_GUARD`).
 */

/** Fuso usado quando o agente não tem agendamento configurado. */
export const DEFAULT_AGENT_TIMEZONE = "America/Sao_Paulo";

const WEEKDAYS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const SNIPPET_MAX = 70;

const pad = (n: number) => String(n).padStart(2, "0");

/** Dias de calendário local de `from` até `to` (negativo se `to` é antes). */
export function calendarDayDiff(from: Date, to: Date, timeZone: string): number {
  const toUtc = (key: string) => {
    const [y, m, d] = key.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(dayKeyInZone(to, timeZone)) - toUtc(dayKeyInZone(from, timeZone))) / 86_400_000);
}

/** "29/09" no fuso. */
export function shortDateInZone(at: Date, timeZone: string): string {
  const p = partsInZone(at, timeZone);
  return `${pad(p.day)}/${pad(p.month)}`;
}

/**
 * "hoje", "amanhã", "depois de amanhã", "ontem", "anteontem" — ou, fora disso,
 * "quinta-feira, 02/10". Calculado no servidor para o LLM não ter que fazer
 * aritmética de calendário (que é onde ele erra).
 */
export function relativeDayLabel(target: Date, now: Date, timeZone: string): string {
  const diff = calendarDayDiff(now, target, timeZone);
  if (diff === 0) return "hoje";
  if (diff === 1) return "amanhã";
  if (diff === 2) return "depois de amanhã";
  if (diff === -1) return "ontem";
  if (diff === -2) return "anteontem";
  return `${WEEKDAYS[partsInZone(target, timeZone).weekday]}, ${shortDateInZone(target, timeZone)}`;
}

/** "terça-feira, 29/09/2026, 08:38". */
export function nowLabel(now: Date, timeZone: string): string {
  const p = partsInZone(now, timeZone);
  return `${WEEKDAYS[p.weekday]}, ${pad(p.day)}/${pad(p.month)}/${p.year}, ${timeInZone(now, timeZone)}`;
}

/** Marca de tempo para transcrições: "hoje 08:38", "ontem 20:24", "25/09 14:10". */
export function transcriptStamp(at: Date, now: Date, timeZone: string): string {
  const diff = calendarDayDiff(at, now, timeZone);
  const day = diff === 0 ? "hoje" : diff === 1 ? "ontem" : shortDateInZone(at, timeZone);
  return `${day} ${timeInZone(at, timeZone)}`;
}

export type TimedMessage = { role: string; content: string; createdAt: Date };

/**
 * Bloco do system prompt com a data de agora, a regra de datas relativas e,
 * quando o histórico começa em outro dia, onde fica essa fronteira.
 */
export function conversationTimeContext(input: {
  now: Date;
  timeZone: string;
  history: TimedMessage[];
}): string {
  const { now, timeZone, history } = input;
  const lines = [
    `Data e hora agora: ${nowLabel(now, timeZone)} (fuso ${timeZone}).`,
    `- Toda referência relativa de data que você escrever ("hoje", "amanhã", "ontem", "sexta", "semana que vem") é calculada a partir desta data e hora. Para falar de uma consulta, compare a data dela com a data de hoje.`,
    `- Nunca copie "hoje", "amanhã" ou parecidos de mensagens anteriores da conversa, nem dos exemplos das suas instruções: foram escritos em outro momento e podem não valer mais. Se não tiver certeza, diga a data (ex.: "dia ${shortDateInZone(now, timeZone)} às 10:45").`,
  ];

  const todayKey = dayKeyInZone(now, timeZone);
  const todayCount = history.filter((m) => dayKeyInZone(m.createdAt, timeZone) === todayKey).length;
  const lastBefore = [...history].reverse().find((m) => dayKeyInZone(m.createdAt, timeZone) < todayKey);
  if (lastBefore) {
    const when = `${relativeDayLabel(lastBefore.createdAt, now, timeZone)}${calendarDayDiff(lastBefore.createdAt, now, timeZone) <= 2 ? ` (${shortDateInZone(lastBefore.createdAt, timeZone)})` : ""} às ${timeInZone(lastBefore.createdAt, timeZone)}`;
    // Só a nossa própria mensagem é citada: o texto do contato não entra no
    // system prompt (ver cabeçalho do arquivo).
    const who = lastBefore.role === "assistant"
      ? `sua, começando com "${snippet(lastBefore.content)}"`
      : "do contato";
    lines.push(
      `- Atenção: parte da conversa é de dias anteriores. ${todayCount === 0 ? "Nenhuma mensagem é de hoje" : todayCount === 1 ? "Só a última mensagem é de hoje" : `Só as ${todayCount} últimas mensagens são de hoje`}; a mensagem mais recente de antes de hoje foi enviada ${when} (${who}). O "hoje"/"amanhã" dessa mensagem e das anteriores se refere ao dia em que foram escritas, não a hoje.`,
    );
  }
  return lines.join("\n");
}

function snippet(text: string): string {
  const flat = text.replace(/\s+/g, " ").replace(/"/g, "'").trim();
  return flat.length > SNIPPET_MAX ? `${flat.slice(0, SNIPPET_MAX).trimEnd()}…` : flat;
}
