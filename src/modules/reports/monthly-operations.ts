import { partsInZone } from "@/modules/scheduling/time";
import { isHumanClosedDay, type MonthlyAssumptions } from "./monthly-config";

/*
 * O que dá para medir da operação e ainda não estava no relatório mensal:
 * quanto do mês o agente ficou no ar, o que a recepção fez com as conversas que
 * recebeu e em que momento do expediente os contatos chegaram.
 *
 * Tudo puro. Os números saem da mesma passada de `evaluateMonthlyMetrics`, com
 * as mesmas conversas, e são opcionais em `MonthlyMetrics`: snapshot fechado
 * antes deles não os tem, e ausente é "sem registro", nunca zero.
 */

/** Espera acima disto vira incidente em "O que não saiu como planejado". */
export const RECEPTION_LONG_WAIT_SECONDS = 3600;
/**
 * Mensagens que chegam logo depois de a conexão voltar são, em geral, as que o
 * WhatsApp reteve durante a queda (o fechai grava a hora em que recebeu, não a
 * em que o contato escreveu). Contam como contatos afetados.
 */
export const INCIDENT_BACKLOG_MS = 15 * 60 * 1000;

/**
 * Quem cuidou de cada conversa respondida no mês. As três partes somam o total
 * de contatos atendidos: só o agente, passada para a recepção (o agente
 * transferiu) e equipe na conversa (alguém respondeu sem transferência).
 */
export type ReceptionMetrics = {
  agentOnly: number; transferred: number; teamJoined: number;
  /** Das transferidas: respondidas por uma pessoa até o fim do mês. */
  answered: number;
  /** Mediana, em segundos corridos, da transferência à primeira resposta humana. Null sem resposta. */
  medianSeconds: number | null;
  /** Esperaram mais de 1 hora (inclui as que ainda esperam). */
  overHour: number;
  /** Sem resposta humana até o fim do mês (ou até agora, no mês em andamento). */
  unanswered: number;
};

/**
 * Momento da chegada pelo expediente que a clínica cadastrou — não por faixa
 * fixa: "depois de fechar" numa clínica é 18h e em outra é 20h, e sábado à
 * tarde é expediente em uma e dia fechado em outra.
 */
export type ArrivalBreakdown = { inside: number; beforeOpen: number; onBreak: number; afterClose: number; closedDay: number; unclassified: number };
export type ArrivalSlot = keyof ArrivalBreakdown;
export const emptyArrivals = (): ArrivalBreakdown => ({ inside: 0, beforeOpen: 0, onBreak: 0, afterClose: 0, closedDay: 0, unclassified: 0 });
export const ARRIVAL_LABEL: Record<ArrivalSlot, string> = {
  inside: "No expediente", beforeOpen: "Antes de abrir", onBreak: "No intervalo", afterClose: "Depois de fechar",
  closedDay: "Dia sem expediente", unclassified: "Sem horário de chegada",
};

export function arrivalSlot(at: Date | null, config: Pick<MonthlyAssumptions, "humanHours" | "timezone"> & Partial<Pick<MonthlyAssumptions, "humanClosedDates">>): ArrivalSlot {
  if (!at || !config.humanHours) return "unclassified";
  if (isHumanClosedDay(at, config)) return "closedDay";
  const p = partsInZone(at, config.timezone), minute = p.hour * 60 + p.minute;
  const day = [...config.humanHours[p.weekday]].sort((a, b) => a.start - b.start);
  if (!day.length) return "closedDay";
  if (day.some((h) => minute >= h.start && minute < h.end)) return "inside";
  if (minute < day[0].start) return "beforeOpen";
  return minute >= day[day.length - 1].end ? "afterClose" : "onBreak";
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export type UptimeIncident = { provider: string; startedAt: Date; endedAt: Date | null };
export type AvailabilityIncident = {
  startedAt: string;
  /** Null = ainda fora do ar no fim do período medido. */
  endedAt: string | null;
  seconds: number;
  /** Contatos que escreveram durante a queda ou logo que a conexão voltou. */
  contacts: number;
};
export type AvailabilityMetrics = {
  /** Início do período medido dentro do mês. */
  measuredFrom: string;
  /** A medição começou depois do início do mês. */
  partial: boolean;
  coveredSeconds: number; downSeconds: number;
  /** Uma casa decimal, arredondada para baixo: queda nunca vira 100%. */
  percent: number;
  incidents: AvailabilityIncident[];
  contactsAffected: number;
};

/**
 * Disponibilidade no mês. `null` quando não houve medição no período (a conta
 * ainda não era monitorada): não medido, jamais 100% presumido. Quedas de
 * conexões diferentes que se sobrepõem contam uma vez só.
 */
export function availabilityMetrics(input: {
  start: Date; end: Date; now: Date; trackedSince: Date | null;
  incidents: UptimeIncident[]; inbound: { conversationId: string; at: Date }[];
}): AvailabilityMetrics | null {
  const { start, end, now, trackedSince } = input;
  if (!trackedSince) return null;
  const from = Math.max(start.getTime(), trackedSince.getTime()), to = Math.min(end.getTime(), now.getTime());
  if (to <= from) return null;
  const clipped = input.incidents
    .map((i) => ({ s: Math.max(i.startedAt.getTime(), from), e: Math.min(i.endedAt?.getTime() ?? to, to), open: !i.endedAt || i.endedAt.getTime() > to }))
    .filter((i) => i.e > i.s).sort((a, b) => a.s - b.s);
  const merged: typeof clipped = [];
  for (const i of clipped) {
    const last = merged.at(-1);
    if (last && i.s <= last.e) { if (i.e > last.e) { last.e = i.e; last.open = i.open; } } else merged.push({ ...i });
  }
  const affected = new Set<string>();
  const incidents = merged.map((i) => {
    const contacts = new Set(input.inbound.filter((m) => m.at.getTime() >= i.s && m.at.getTime() < i.e + INCIDENT_BACKLOG_MS).map((m) => m.conversationId));
    for (const id of contacts) affected.add(id);
    return { startedAt: new Date(i.s).toISOString(), endedAt: i.open ? null : new Date(i.e).toISOString(), seconds: Math.round((i.e - i.s) / 1000), contacts: contacts.size };
  });
  const coveredSeconds = Math.round((to - from) / 1000), downSeconds = incidents.reduce((sum, i) => sum + i.seconds, 0);
  return { measuredFrom: new Date(from).toISOString(), partial: from > start.getTime(), coveredSeconds, downSeconds,
    percent: Math.floor((1 - downSeconds / coveredSeconds) * 1000) / 10, incidents, contactsAffected: affected.size };
}
