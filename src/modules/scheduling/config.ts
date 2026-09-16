import { partsInZone } from "./time";

/**
 * Configuração da ação "Agendar horário", guardada em `TenantAction.config`
 * (chave `schedule_meeting`) — por agente, como toda ação.
 *
 * Mora aqui, e não em campos novos no `Agent`, porque é configuração DA AÇÃO:
 * quem não liga o agendamento não tem horário de atendimento nenhum para
 * responder. `TenantAction.config` já existia como Json exatamente para isto e
 * até agora nenhuma ação usava.
 */
export type ScheduleConfig = {
  /** Pausas recorrentes em todos os dias de atendimento. */
  breaks: { label: string; startTime: string; endTime: string }[];
  allowCancellation: boolean;
  allowRescheduling: boolean;
  recognizeExisting: boolean;
  /** Duração padrão de cada compromisso, em minutos. */
  durationMinutes: number;
  /** Fuso em que o negócio atende (IANA). */
  timezone: string;
  /** Dias atendidos, domingo = 0. */
  workdays: number[];
  /** "09:00" — início do expediente, no fuso acima. */
  startTime: string;
  /** "18:00" — fim do expediente. */
  endTime: string;
  /** Onde acontece: "no salão", "Google Meet", "ligação". Vai na resposta. */
  location: string;
  /** Antecedência mínima em horas — evita o agente marcar "daqui a 5 minutos". */
  minNoticeHours: number;
};

export const DEFAULT_SCHEDULE_CONFIG: ScheduleConfig = {
  breaks: [],
  allowCancellation: false,
  allowRescheduling: false,
  recognizeExisting: true,
  durationMinutes: 60,
  timezone: "America/Sao_Paulo",
  workdays: [1, 2, 3, 4, 5],
  startTime: "09:00",
  endTime: "18:00",
  location: "",
  minNoticeHours: 2,
};

const WEEKDAY_LABELS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const WEEKDAY_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export function weekdayLabel(day: number) {
  return WEEKDAY_LABELS[day] ?? String(day);
}

export function isScheduleTime(v: unknown): v is string {
  return typeof v === "string" && /^(?:[01]?\d|2[0-3]):[0-5]\d$/.test(v);
}

function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function isScheduleTimezone(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false;
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Validação compartilhada pelo formulário e pelos testes. */
export function validateScheduleBreaks(cfg: Pick<ScheduleConfig, "startTime" | "endTime" | "breaks">): string | null {
  const ordered = [...cfg.breaks].sort((a, b) => minutesOf(a.startTime) - minutesOf(b.startTime));
  for (let i = 0; i < ordered.length; i++) {
    const pause = ordered[i];
    if (!isScheduleTime(pause.startTime) || !isScheduleTime(pause.endTime) || minutesOf(pause.startTime) >= minutesOf(pause.endTime)) {
      return "Cada pausa precisa ter um início e um fim válido, depois do início.";
    }
    if (minutesOf(pause.startTime) < minutesOf(cfg.startTime) || minutesOf(pause.endTime) > minutesOf(cfg.endTime)) {
      return "As pausas precisam ficar dentro do expediente.";
    }
    if (i > 0 && minutesOf(pause.startTime) < minutesOf(ordered[i - 1].endTime)) {
      return "As pausas não podem se sobrepor.";
    }
  }
  return null;
}

/**
 * Lê o Json cru do banco com defaults campo a campo. Nunca lança: config vinda
 * do banco pode ser null (ação recém-criada), de uma versão anterior do formato
 * ou editada à mão — e uma agenda quebrada não pode derrubar o atendimento.
 */
export function parseScheduleConfig(raw: unknown): ScheduleConfig {
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const workdays = Array.isArray(c.workdays)
    ? c.workdays.filter((d): d is number => typeof d === "number" && Number.isInteger(d) && d >= 0 && d <= 6)
    : null;

  const start = isScheduleTime(c.startTime) ? c.startTime : DEFAULT_SCHEDULE_CONFIG.startTime;
  const end = isScheduleTime(c.endTime) ? c.endTime : DEFAULT_SCHEDULE_CONFIG.endTime;
  const breaks = Array.isArray(c.breaks) ? c.breaks.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const b = raw as Record<string, unknown>;
    if (!isScheduleTime(b.startTime) || !isScheduleTime(b.endTime) || minutesOf(b.startTime) >= minutesOf(b.endTime)) return [];
    return [{ label: typeof b.label === "string" ? b.label.slice(0, 60) : "Pausa", startTime: b.startTime, endTime: b.endTime }];
  }) : [];

  return {
    breaks,
    allowCancellation: c.allowCancellation === true,
    allowRescheduling: c.allowRescheduling === true,
    recognizeExisting: c.recognizeExisting !== false,
    durationMinutes:
      typeof c.durationMinutes === "number" && c.durationMinutes >= 5 && c.durationMinutes <= 480
        ? Math.round(c.durationMinutes)
        : DEFAULT_SCHEDULE_CONFIG.durationMinutes,
    timezone: isScheduleTimezone(c.timezone) ? c.timezone : DEFAULT_SCHEDULE_CONFIG.timezone,
    workdays: workdays && workdays.length > 0 ? [...new Set(workdays)].sort() : DEFAULT_SCHEDULE_CONFIG.workdays,
    // Fim antes do início seria um expediente vazio: cai no padrão em vez de
    // recusar todo horário que o lead propuser.
    startTime: minutesOf(start) < minutesOf(end) ? start : DEFAULT_SCHEDULE_CONFIG.startTime,
    endTime: minutesOf(start) < minutesOf(end) ? end : DEFAULT_SCHEDULE_CONFIG.endTime,
    location: typeof c.location === "string" ? c.location.slice(0, 200) : "",
    minNoticeHours:
      typeof c.minNoticeHours === "number" && c.minNoticeHours >= 0 && c.minNoticeHours <= 168
        ? Math.round(c.minNoticeHours)
        : DEFAULT_SCHEDULE_CONFIG.minNoticeHours,
  };
}

/** Resumo em uma linha — usado nos cards da configuração e da agenda. */
export function describeSchedule(cfg: ScheduleConfig): string {
  const days = cfg.workdays.map((d) => WEEKDAY_SHORT[d]).join(", ");
  return `${days} · ${cfg.startTime}–${cfg.endTime} · blocos de ${cfg.durationMinutes} min${cfg.breaks.length ? ` · ${cfg.breaks.length} pausa(s)` : ""}`;
}

/**
 * Contexto que vai para o LLM junto do system prompt quando o agendamento está
 * ligado. Sem isto o agente marcava domingo às 3h da manhã: ele não tinha como
 * saber o expediente, e a tool só recusava depois — gastando um turno.
 */
export function scheduleSystemContext(cfg: ScheduleConfig, now = new Date()): string {
  const p = partsInZone(now, cfg.timezone);
  const today = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  const days = cfg.workdays.map((d) => WEEKDAY_LABELS[d]).join(", ");

  return [
    "Agendamento:",
    `- Hoje é ${today} (${WEEKDAY_LABELS[p.weekday]}), ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")} no fuso ${cfg.timezone}.`,
    `- Atendemos ${days}, das ${cfg.startTime} às ${cfg.endTime}.`,
    `- Cada horário dura ${cfg.durationMinutes} minutos.`,
    ...cfg.breaks.map((b) => `- Pausa${b.label ? ` (${b.label})` : ""}: ${b.startTime}–${b.endTime}. Não ofereça nem marque horários que atravessem esse intervalo.`),
    cfg.minNoticeHours > 0
      ? `- Só marque com pelo menos ${cfg.minNoticeHours}h de antecedência.`
      : "",
    cfg.location ? `- Local/formato: ${cfg.location}.` : "",
    "- Antes de sugerir QUALQUER horário, chame list_available_slots e ofereça somente horários dessa lista. O expediente acima não diz o que está livre: há consultas já marcadas. Nunca proponha um horário que não veio da lista.",
    "- Se o contato pedir um horário específico, confira em list_available_slots antes de responder. Se estiver ocupado, diga isso já e ofereça os livres mais próximos — nunca aceite o horário para depois voltar atrás.",
    "- Converta o que o contato disser ('amanhã às 15h') para data e hora exatas antes de chamar a ação schedule_meeting.",
    "- Nunca confirme um horário sem antes chamar schedule_meeting e receber a confirmação.",
    "- Depois que schedule_meeting confirmar um horário, não chame de novo para confirmar. Para trocar uma consulta use reschedule_meeting, nunca crie outra consulta no lugar da existente.",
    cfg.recognizeExisting ? "- Reconheça consultas já marcadas: acolha o retorno ou a resposta a um lembrete, agradeça a confirmação e se coloque à disposição. Não reinicie o agendamento nem ofereça novos horários sem pedido do contato." : "",
    "- Consulte list_appointments antes de cancelar ou reagendar; se houver mais de uma consulta, pergunte qual. Nunca invente um ID ou use a consulta de outra pessoa.",
    cfg.allowCancellation
      ? "- Cancelamento habilitado: só após pedido explícito. Diga a data/hora da consulta que será cancelada, pergunte se confirma e ESPERE a próxima mensagem com confirmação clara. Só então chame cancel_meeting com confirmed=true. Frases vagas ('não sei se vou poder ir') não autorizam cancelamento. Após sucesso, encerre com gentileza e se coloque à disposição."
      : "- Cancelamento pelo agente desabilitado. Encaminhe pedidos de cancelamento para atendimento humano, sem afirmar que cancelou.",
    cfg.allowRescheduling
      ? "- Reagendamento habilitado: só quando solicitado. Combine o novo horário respeitando expediente e pausas, confirme com o contato a consulta original e a nova data/hora e ESPERE uma confirmação clara antes de reschedule_meeting com confirmed=true. Se falhar, o horário original continua reservado."
      : "- Reagendamento pelo agente desabilitado. Encaminhe pedidos de mudança para atendimento humano; não crie outro agendamento para contornar isso.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Inícios possíveis ("HH:MM") de um dia de atendimento: blocos da duração a
 * partir do início do expediente e de novo a partir do fim de cada pausa — com
 * almoço 12:00–13:00 e blocos de 45 min, a tarde começa às 13:00, não às 13:30.
 * Não olha dia da semana nem conflito; isso fica com `listFreeSlots`.
 */
export function slotStartTimes(cfg: ScheduleConfig): string[] {
  const end = minutesOf(cfg.endTime);
  const starts = new Set<number>();
  for (const from of [minutesOf(cfg.startTime), ...cfg.breaks.map((b) => minutesOf(b.endTime))]) {
    for (let m = from; m + cfg.durationMinutes <= end; m += cfg.durationMinutes) starts.add(m);
  }
  return [...starts]
    .sort((a, b) => a - b)
    .map((m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
}

/** O horário cai dentro do expediente configurado? */
export function isWithinBusinessHours(startsAt: Date, cfg: ScheduleConfig): boolean {
  const p = partsInZone(startsAt, cfg.timezone);
  if (!cfg.workdays.includes(p.weekday)) return false;
  const minutes = p.hour * 60 + p.minute;
  const end = minutes + cfg.durationMinutes;
  return minutes >= minutesOf(cfg.startTime) && end <= minutesOf(cfg.endTime)
    && !cfg.breaks.some((b) => minutes < minutesOf(b.endTime) && end > minutesOf(b.startTime));
}
