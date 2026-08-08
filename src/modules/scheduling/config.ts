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

function isTime(v: unknown): v is string {
  return typeof v === "string" && /^\d{1,2}:\d{2}$/.test(v);
}

function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Lê o Json cru do banco com defaults campo a campo. Nunca lança: config vinda
 * do banco pode ser null (ação recém-criada), de uma versão anterior do formato
 * ou editada à mão — e uma agenda quebrada não pode derrubar o atendimento.
 */
export function parseScheduleConfig(raw: unknown): ScheduleConfig {
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const workdays = Array.isArray(c.workdays)
    ? c.workdays.filter((d): d is number => typeof d === "number" && d >= 0 && d <= 6)
    : null;

  const start = isTime(c.startTime) ? c.startTime : DEFAULT_SCHEDULE_CONFIG.startTime;
  const end = isTime(c.endTime) ? c.endTime : DEFAULT_SCHEDULE_CONFIG.endTime;

  return {
    durationMinutes:
      typeof c.durationMinutes === "number" && c.durationMinutes >= 5 && c.durationMinutes <= 480
        ? Math.round(c.durationMinutes)
        : DEFAULT_SCHEDULE_CONFIG.durationMinutes,
    timezone: typeof c.timezone === "string" && c.timezone ? c.timezone : DEFAULT_SCHEDULE_CONFIG.timezone,
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
  return `${days} · ${cfg.startTime}–${cfg.endTime} · blocos de ${cfg.durationMinutes} min`;
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
    cfg.minNoticeHours > 0
      ? `- Só marque com pelo menos ${cfg.minNoticeHours}h de antecedência.`
      : "",
    cfg.location ? `- Local/formato: ${cfg.location}.` : "",
    "- Converta o que o contato disser ('amanhã às 15h') para data e hora exatas antes de chamar a ação schedule_meeting.",
    "- Nunca confirme um horário sem antes chamar schedule_meeting e receber a confirmação.",
    "- Depois que schedule_meeting confirmar um horário, não chame de novo para o mesmo horário — ele já está marcado. Só chame outra vez se o contato pedir uma DATA OU HORA diferente.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** O horário cai dentro do expediente configurado? */
export function isWithinBusinessHours(startsAt: Date, cfg: ScheduleConfig): boolean {
  const p = partsInZone(startsAt, cfg.timezone);
  if (!cfg.workdays.includes(p.weekday)) return false;
  const minutes = p.hour * 60 + p.minute;
  return minutes >= minutesOf(cfg.startTime) && minutes + cfg.durationMinutes <= minutesOf(cfg.endTime);
}
