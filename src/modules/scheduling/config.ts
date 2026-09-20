import { partsInZone } from "./time";
import { describeRanges, getWeeklyAvailability, mergeRanges, minuteLabel, parseWeeklyAvailability, type WeeklyAvailability } from "./weekly-availability";

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
  /** Grade por dia. Ausente somente no formato antigo; semana vazia = fechado. */
  weeklyAvailability?: WeeklyAvailability;
  /** Pausas recorrentes em todos os dias de atendimento. */
  breaks: { label: string; startTime: string; endTime: string }[];
  allowCancellation: boolean;
  allowRescheduling: boolean;
  recognizeExisting: boolean;
  /** Duração padrão de cada compromisso, em minutos. */
  durationMinutes: number;
  /**
   * Tipos de atendimento com duração própria ("Limpeza · 30 min").
   *
   * Vazio é o caso comum: a conta que atende tudo no mesmo bloco continua
   * mexendo só em `durationMinutes`. Quando há variações, `durationMinutes`
   * segue sendo o padrão — o que o agente reserva quando o contato não disse
   * o tipo, e o que a grade de horários usa. Não é uma lista de serviços do
   * negócio: é só o que muda o tamanho do bloco na agenda.
   */
  durations: { label: string; minutes: number }[];
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
  /**
   * Datas em que o negócio não atende, mesmo caindo num dia da semana liberado
   * na grade: feriado, recesso, congresso, reforma.
   *
   * Existe porque a grade só conhece DIA DA SEMANA — para ela, 25/12 numa
   * quarta é só mais uma quarta, e sem isto o agente marcaria consulta no
   * Natal. É uma lista manual de propósito: feriado nacional nem sempre é
   * feriado para a clínica (muitas atendem), feriado municipal não cabe numa
   * tabela nossa, e recesso não é feriado nenhum — quem sabe o que fecha é o
   * dono, e uma lista automática erraria dos dois lados.
   *
   * Cada item é `YYYY-MM-DD` no fuso do negócio (`timezone`), não um instante:
   * "25 de dezembro" é um dia do calendário de quem atende, e guardar UTC faria
   * o bloqueio escorregar para o dia 24 ou 26 dependendo do fuso.
   *
   * Ordenada e sem repetição na leitura. Vazia é o caso comum.
   */
  blockedDates: BlockedDate[];
  /**
   * Manda lembretes ao contato antes da consulta. Nasce desligado: quem
   * acabou de ligar o agendamento não escolheu mandar mensagem sozinho.
   */
  reminderEnabled: boolean;
  /**
   * Os lembretes, um por disparo. Uma clínica costuma querer mais de um
   * ("1 semana antes" para dar tempo de remarcar, "2 horas antes" para quem
   * já esqueceu), e cada um diz algo diferente — por isso cada linha tem o
   * texto junto da antecedência, e não um texto só para todos.
   *
   * Ordenada por antecedência decrescente na leitura (o mais distante
   * primeiro), que é a ordem em que os disparos acontecem e a ordem em que a
   * tela lista.
   */
  reminders: ReminderRule[];
};

export type BlockedDate = {
  /** Dia do calendário no fuso do negócio, `YYYY-MM-DD`. */
  date: string;
  /**
   * Por que fecha ("Natal", "Recesso"). Só para a pessoa se reconhecer na
   * lista meses depois — o agente não precisa do motivo para não oferecer o
   * dia, então uma data sem rótulo continua valendo.
   */
  label: string;
};

export type ReminderRule = {
  /**
   * Antecedência em minutos. Guardado em minutos (não horas, dias ou semanas)
   * pelo mesmo motivo de `FollowUpConfig.delayMinutes`: a clínica que quer
   * "30 minutos antes" não pode ser arredondada para uma hora. A tela deixa
   * escolher a unidade; ela é só a forma de digitar.
   */
  minutesBefore: number;
  /** Texto deste disparo, com as variáveis de `REMINDER_VARIABLES`. */
  template: string;
};

/**
 * O que o template do lembrete aceita. Exportado porque a tela lista os
 * tokens para quem escreve e os testes conferem a mesma lista — duas cópias
 * divergiriam na primeira variável nova.
 */
export const REMINDER_VARIABLES = [
  { token: "{{nome}}", label: "nome do contato" },
  { token: "{{data}}", label: "data da consulta" },
  { token: "{{hora}}", label: "horário" },
  { token: "{{local}}", label: "local/formato, quando configurado" },
] as const;

export const DEFAULT_REMINDER_TEMPLATE =
  "Oi {{nome}}! Passando para lembrar da sua consulta {{data}} às {{hora}}{{local}}. Posso confirmar que você vem?";

/**
 * Teto da antecedência de um lembrete: 8 semanas. Acima disso não é lembrete
 * de consulta, é outra campanha — e a consulta provavelmente nem existia
 * quando o disparo teria de ser agendado.
 */
export const MAX_REMINDER_MINUTES = 8 * 7 * 24 * 60;

/** Padrão prometido pela tela ao ligar o lembrete: um dia antes. */
export const DEFAULT_REMINDER_MINUTES = 24 * 60;

/**
 * A partir daqui a tela avisa que muitos lembretes podem irritar o paciente.
 * Não é limite: passar disso é decisão do dono da conta, que é quem conhece a
 * própria base. Mas quem leva o bloqueio é o número da clínica, e isso
 * precisa estar escrito antes de acontecer.
 */
export const REMINDER_COUNT_WARNING = 10;

/**
 * Unidades da antecedência. Minutos a semanas: o intervalo real vai de "30
 * minutos antes" (quem já está a caminho) a "2 semanas antes" (procedimento
 * que exige preparo).
 */
export const REMINDER_UNITS = [
  { value: "minutes", label: "minutos antes", minutes: 1 },
  { value: "hours", label: "horas antes", minutes: 60 },
  { value: "days", label: "dias antes", minutes: 24 * 60 },
  { value: "weeks", label: "semanas antes", minutes: 7 * 24 * 60 },
] as const;

export type ReminderUnit = (typeof REMINDER_UNITS)[number]["value"];

/**
 * A maior unidade em que a antecedência é um número inteiro — 1440 min vira
 * "1 dia", não "1440 minutos". É como a tela reabre o valor salvo: do jeito
 * que a pessoa provavelmente digitou.
 */
export function splitReminderLead(minutes: number): { amount: number; unit: ReminderUnit } {
  for (const unit of [...REMINDER_UNITS].reverse()) {
    if (minutes >= unit.minutes && minutes % unit.minutes === 0) {
      return { amount: minutes / unit.minutes, unit: unit.value };
    }
  }
  return { amount: minutes, unit: "minutes" };
}

/** Faixa aceita por qualquer duração — a padrão e as variações. */
export const MIN_DURATION_MINUTES = 5;
export const MAX_DURATION_MINUTES = 480;

/** Teto de variações. O agente precisa escolher uma lendo a lista no prompt. */
export const MAX_DURATIONS = 12;

/**
 * Teto de datas bloqueadas. Alto porque cabe um ano inteiro de feriados mais o
 * recesso, e baixo o bastante para a lista não crescer sem fim dentro de um
 * Json que é lido a cada turno do agente.
 */
export const MAX_BLOCKED_DATES = 120;

/**
 * Quantas datas bloqueadas entram no prompt do agente. A lista inteira pode
 * ter um ano de feriados; o contato marca para as próximas semanas, e cada
 * linha aqui é token gasto em todo turno da conversa.
 */
export const MAX_BLOCKED_DATES_IN_PROMPT = 12;

/** `YYYY-MM-DD` que existe de verdade no calendário (recusa 31/02). */
export function isCalendarDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [year, month, day] = v.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1) return false;
  // Dia 0 do mês seguinte = último dia deste mês; cobre bissexto sem tabela.
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export const DEFAULT_SCHEDULE_CONFIG: ScheduleConfig = {
  breaks: [],
  allowCancellation: false,
  allowRescheduling: false,
  recognizeExisting: true,
  durationMinutes: 60,
  durations: [],
  timezone: "America/Sao_Paulo",
  workdays: [1, 2, 3, 4, 5],
  startTime: "09:00",
  endTime: "18:00",
  location: "",
  minNoticeHours: 2,
  blockedDates: [],
  reminderEnabled: false,
  reminders: [{ minutesBefore: DEFAULT_REMINDER_MINUTES, template: DEFAULT_REMINDER_TEMPLATE }],
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

/**
 * Chave de comparação de nome de variação: sem acento, sem caixa, sem espaço
 * sobrando. O LLM devolve o rótulo copiado do prompt, mas não com fidelidade
 * garantida — "limpeza" e "Limpeza" têm que cair na mesma linha, senão o
 * agente reservaria o bloco padrão calado depois de combinar outro.
 */
export function normalizeDurationLabel(label: string): string {
  return label.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

/**
 * Minutos que o agendamento vai ocupar, dado o tipo escolhido na conversa.
 *
 * Nome desconhecido (ou ausente) cai na duração padrão em vez de recusar: um
 * bloco do tamanho errado é corrigível pela clínica, um agendamento não feito
 * é um lead perdido. Quem precisa avisar o LLM sobre a escolha usa o `label`
 * devolvido — `null` quer dizer "usei o padrão".
 */
export function resolveDuration(
  cfg: ScheduleConfig,
  requested?: string | null,
): { minutes: number; label: string | null; matched: boolean } {
  const wanted = typeof requested === "string" ? normalizeDurationLabel(requested) : "";
  if (!wanted) return { minutes: cfg.durationMinutes, label: null, matched: false };
  const found = cfg.durations.find((d) => normalizeDurationLabel(d.label) === wanted);
  return found
    ? { minutes: found.minutes, label: found.label, matched: true }
    : { minutes: cfg.durationMinutes, label: null, matched: false };
}

/** "Limpeza (30 min), Avaliação (60 min)" — usado no prompt e nos resumos. */
export function describeDurations(cfg: ScheduleConfig): string {
  return cfg.durations.map((d) => `${d.label} (${d.minutes} min)`).join(", ");
}

/**
 * Validação compartilhada pelo formulário e pelo servidor. Devolve a primeira
 * mensagem de erro, no mesmo formato de `validateScheduleBreaks`.
 */
export function validateDurations(durations: { label: string; minutes: number }[]): string | null {
  if (durations.length > MAX_DURATIONS) return `Cadastre no máximo ${MAX_DURATIONS} variações de duração.`;
  const seen = new Set<string>();
  for (const d of durations) {
    if (!d.label.trim()) return "Toda variação precisa de um nome.";
    if (!Number.isInteger(d.minutes) || d.minutes < MIN_DURATION_MINUTES || d.minutes > MAX_DURATION_MINUTES) {
      return `A duração de cada variação vai de ${MIN_DURATION_MINUTES} a ${MAX_DURATION_MINUTES} minutos.`;
    }
    const key = normalizeDurationLabel(d.label);
    if (seen.has(key)) return `Há duas variações chamadas "${d.label.trim()}". Use nomes diferentes.`;
    seen.add(key);
  }
  return null;
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

  // Variação sem nome ou com duração fora da faixa é descartada, não corrigida:
  // uma linha pela metade viraria "sem nome · 60 min" no prompt, e o agente
  // ofereceria ao contato um tipo de atendimento que ninguém cadastrou.
  const seen = new Set<string>();
  const durations = Array.isArray(c.durations) ? c.durations.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const d = raw as Record<string, unknown>;
    const label = typeof d.label === "string" ? d.label.trim().slice(0, 60) : "";
    const minutes = typeof d.minutes === "number" && Number.isFinite(d.minutes) ? Math.round(d.minutes) : 0;
    if (!label || minutes < MIN_DURATION_MINUTES || minutes > MAX_DURATION_MINUTES) return [];
    // Nome repetido não tem como ser escolhido sem ambiguidade pelo agente.
    const key = normalizeDurationLabel(label);
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ label, minutes }];
  }).slice(0, MAX_DURATIONS) : [];

  return {
    ...(c.weeklyAvailability !== undefined ? { weeklyAvailability: parseWeeklyAvailability(c.weeklyAvailability) } : {}),
    breaks,
    durations,
    allowCancellation: c.allowCancellation === true,
    allowRescheduling: c.allowRescheduling === true,
    recognizeExisting: c.recognizeExisting !== false,
    durationMinutes:
      typeof c.durationMinutes === "number"
        && c.durationMinutes >= MIN_DURATION_MINUTES
        && c.durationMinutes <= MAX_DURATION_MINUTES
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
    // Config antiga não tem o campo: lista vazia, que é "não bloqueia nada" —
    // o comportamento que essas contas já tinham.
    blockedDates: parseBlockedDates(c.blockedDates),
    // Config antiga (sem estes campos) não liga o lembrete sozinho: mandar
    // mensagem para a base de pacientes de uma conta é decisão do dono, não
    // efeito colateral de uma atualização do produto.
    reminderEnabled: c.reminderEnabled === true,
    reminders: parseReminders(c),
  };
}

/**
 * Lê a lista de lembretes.
 *
 * Aceita os dois formatos: `reminders` (atual) e, para configs salvas quando
 * o lembrete ainda era um só, `reminderMinutesBefore` + `reminderTemplate` —
 * convertidos na leitura, para nenhuma conta perder o lembrete que já tinha
 * configurado. Mesma lição do `delayHours` do follow-up: **não remova este
 * fallback** sem migrar as linhas, senão todo lembrete já escolhido volta
 * para o padrão em silêncio.
 *
 * Nunca lança: a linha pode ser null, de outra versão do formato ou editada à
 * mão, e uma agenda quebrada não pode derrubar o atendimento.
 */
function parseReminders(c: Record<string, unknown>): ReminderRule[] {
  const fromList = Array.isArray(c.reminders)
    ? c.reminders.flatMap((raw): ReminderRule[] => {
        if (!raw || typeof raw !== "object") return [];
        const r = raw as Record<string, unknown>;
        const minutes = typeof r.minutesBefore === "number" && Number.isFinite(r.minutesBefore)
          ? Math.round(r.minutesBefore)
          : null;
        if (minutes === null || minutes < 1 || minutes > MAX_REMINDER_MINUTES) return [];
        return [{
          minutesBefore: minutes,
          template: typeof r.template === "string" && r.template.trim()
            ? r.template.trim().slice(0, 500)
            : DEFAULT_REMINDER_TEMPLATE,
        }];
      })
    : null;

  // Formato antigo: um lembrete só, em campos soltos.
  const legacy = (() => {
    if (fromList && fromList.length > 0) return null;
    if (c.reminderMinutesBefore === undefined && c.reminderTemplate === undefined) return null;
    const minutes = typeof c.reminderMinutesBefore === "number"
      && Number.isFinite(c.reminderMinutesBefore)
      && c.reminderMinutesBefore >= 1
      && c.reminderMinutesBefore <= MAX_REMINDER_MINUTES
      ? Math.round(c.reminderMinutesBefore)
      : DEFAULT_REMINDER_MINUTES;
    const template = typeof c.reminderTemplate === "string" && c.reminderTemplate.trim()
      ? c.reminderTemplate.trim().slice(0, 500)
      : DEFAULT_REMINDER_TEMPLATE;
    return [{ minutesBefore: minutes, template }];
  })();

  const list = (fromList && fromList.length > 0 ? fromList : legacy)
    ?? DEFAULT_SCHEDULE_CONFIG.reminders;

  // Um disparo por momento: dois lembretes no mesmo instante são duas
  // mensagens coladas para o paciente. A escrita também recusa, mas a leitura
  // não pode confiar numa linha que pode ter sido editada à mão.
  const seen = new Set<number>();
  return list
    .filter((r) => (seen.has(r.minutesBefore) ? false : seen.add(r.minutesBefore) && true))
    // Do mais distante para o mais próximo: a ordem dos disparos, e a ordem
    // em que a tela lista.
    .sort((a, b) => b.minutesBefore - a.minutesBefore);
}

/**
 * "1 dia", "2 horas", "90 minutos" — a antecedência escrita como gente fala.
 * Usada no resumo do card, no eco embaixo do campo e no texto de ajuda.
 */
export function formatReminderLead(minutes: number): string {
  const { amount, unit } = splitReminderLead(minutes);
  const NOUN: Record<ReminderUnit, string> = {
    minutes: "minuto",
    hours: "hora",
    days: "dia",
    weeks: "semana",
  };
  return `${amount} ${NOUN[unit]}${amount === 1 ? "" : "s"}`;
}

/**
 * Validação da lista de lembretes, compartilhada pelo formulário e pelo
 * servidor. Devolve a primeira mensagem de erro, ou null.
 *
 * Não há teto de quantidade de propósito: quantos lembretes o paciente
 * aguenta é decisão de quem conhece a própria base. A tela avisa a partir de
 * `REMINDER_COUNT_WARNING`, mas não impede.
 */
export function validateReminders(reminders: ReminderRule[]): string | null {
  const seen = new Set<number>();
  for (const r of reminders) {
    if (!Number.isFinite(r.minutesBefore) || r.minutesBefore < 1) {
      return "Cada lembrete precisa de uma antecedência de pelo menos 1 minuto.";
    }
    if (r.minutesBefore > MAX_REMINDER_MINUTES) {
      return `A antecedência máxima de um lembrete é ${formatReminderLead(MAX_REMINDER_MINUTES)}.`;
    }
    if (!r.template.trim()) {
      return "Escreva a mensagem de cada lembrete.";
    }
    // Dois disparos no mesmo instante são duas mensagens coladas — quase
    // sempre "1 dia" e "24 horas" digitados sem perceber que são o mesmo.
    if (seen.has(r.minutesBefore)) {
      return `Você já tem um lembrete ${formatReminderLead(r.minutesBefore)} antes. Escolha outro momento.`;
    }
    seen.add(r.minutesBefore);
  }
  return null;
}

/**
 * Preenche o template do lembrete.
 *
 * Duas regras que não são óbvias:
 *
 * - **`{{local}}` já vem com a preposição** (" no salão"), e vira string vazia
 *   quando a conta não configurou local. O template padrão escreve
 *   "às {{hora}}{{local}}." justamente por isso: com o token solto, uma conta
 *   sem local receberia "às 15:00 em ." na mensagem.
 * - **Token desconhecido é apagado, não impresso cru.** Quem digitar
 *   "{{médico}}" achando que existe recebe uma frase com um buraco, que é
 *   ruim — mas melhor do que mandar "{{médico}}" para o paciente.
 *
 * A limpeza no fim existe porque contato sem nome cadastrado é comum (o
 * WhatsApp nem sempre entrega um): "Oi {{nome}}!" viraria "Oi !", com o espaço
 * e a pontuação órfãos. Some o espaço antes da pontuação, o espaço duplo e a
 * linha que ficou vazia.
 */
export function renderReminder(
  template: string,
  vars: { nome: string; data: string; hora: string; local?: string },
): string {
  const values: Record<string, string> = {
    nome: vars.nome.trim(),
    data: vars.data,
    hora: vars.hora,
    // Já vem com a preposição: ver a regra do `{{local}}` acima.
    local: vars.local?.trim() ? ` ${vars.local.trim()}` : "",
  };
  return template
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => values[key.toLowerCase()] ?? "")
    .replace(/[ \t]+([,.!?;:])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

/**
 * O trecho dos lembretes no resumo de uma linha. Um lembrete escreve o
 * momento ("lembrete 1 dia antes"); vários escrevem a contagem e o primeiro
 * disparo, porque listar cinco antecedências estouraria a linha do card.
 */
function describeReminders(cfg: ScheduleConfig): string {
  if (!cfg.reminderEnabled || cfg.reminders.length === 0) return "";
  const [first] = cfg.reminders;
  if (cfg.reminders.length === 1) return ` · lembrete ${formatReminderLead(first.minutesBefore)} antes`;
  return ` · ${cfg.reminders.length} lembretes (a partir de ${formatReminderLead(first.minutesBefore)} antes)`;
}

/** Resumo em uma linha — usado nos cards da configuração e da agenda. */
export function describeSchedule(cfg: ScheduleConfig): string {
  if (cfg.weeklyAvailability !== undefined) {
    const week = getWeeklyAvailability(cfg);
    const days = week.flatMap((ranges, day) => ranges.length ? [WEEKDAY_SHORT[day]] : []);
    const hours = week.flat().reduce((sum, r) => sum + r.end - r.start, 0) / 60;
    return `${days.length ? `${days.join(", ")} · ${Number(hours.toFixed(2)).toLocaleString("pt-BR")}h por semana` : "Sem horários disponíveis"} · blocos de ${cfg.durationMinutes} min${describeReminders(cfg)}`;
  }
  const days = cfg.workdays.map((d) => WEEKDAY_SHORT[d]).join(", ");
  return `${days} · ${cfg.startTime}–${cfg.endTime} · blocos de ${cfg.durationMinutes} min${cfg.durations.length ? ` (+${cfg.durations.length} variação(ões))` : ""}${cfg.breaks.length ? ` · ${cfg.breaks.length} pausa(s)` : ""}${describeReminders(cfg)}`;
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
    ...(cfg.weeklyAvailability !== undefined
      ? getWeeklyAvailability(cfg).map((ranges, day) => `- ${WEEKDAY_LABELS[day]}: ${describeRanges(ranges)}.`)
      : [`- Atendemos ${days}, das ${cfg.startTime} às ${cfg.endTime}.`]),
    `- Cada horário dura ${cfg.durationMinutes} minutos por padrão.`,
    // Sem a instrução de repassar o nome exato, o LLM parafraseia ("limpeza
    // dental") e a variação não é encontrada — o bloco sai do tamanho padrão
    // sem ninguém perceber.
    ...(cfg.durations.length
      ? [
          `- Tipos de atendimento com duração própria: ${describeDurations(cfg)}.`,
          "- Se o contato disser o que precisa, passe o nome EXATO do tipo em tipoAtendimento ao chamar schedule_meeting. Se não der para saber, pergunte antes de marcar; em último caso marque sem o tipo e o horário fica com a duração padrão.",
        ]
      : []),
    ...(cfg.weeklyAvailability !== undefined ? ["- Só atenda dentro dos períodos de cada dia. Os intervalos entre períodos são pausas: não ofereça consultas que os atravessem."] : cfg.breaks.map((b) => `- Pausa${b.label ? ` (${b.label})` : ""}: ${b.startTime}–${b.endTime}. Não ofereça nem marque horários que atravessem esse intervalo.`)),
    // Só os dias que ainda vão acontecer, e no máximo alguns: feriado do ano
    // passado no prompt é token gasto para uma data que ninguém vai pedir.
    ...(() => {
      const upcoming = cfg.blockedDates.filter((b) => b.date >= today).slice(0, MAX_BLOCKED_DATES_IN_PROMPT);
      if (!upcoming.length) return [];
      return [
        `- NÃO atendemos nestes dias: ${upcoming.map((b) => (b.label ? `${b.date} (${b.label})` : b.date)).join(", ")}.`,
        "- Se o contato pedir um desses dias, diga que não haverá atendimento nessa data e ofereça o dia seguinte de atendimento. Nunca marque nesses dias.",
      ];
    })(),
    cfg.minNoticeHours > 0
      ? `- Só marque com pelo menos ${cfg.minNoticeHours}h de antecedência.`
      : "",
    cfg.location ? `- Local/formato: ${cfg.location}.` : "",
    "- Antes de sugerir QUALQUER horário, chame list_available_slots e ofereça somente horários dessa lista. O expediente acima não diz o que está livre: há consultas já marcadas. Nunca proponha um horário que não veio da lista.",
    "- Se o contato pedir um horário específico, confira em list_available_slots antes de responder. Se estiver ocupado, diga isso já e ofereça os livres mais próximos — nunca aceite o horário para depois voltar atrás.",
    "- Se o contato não pediu uma data exata, pesquise 14 dias e apresente um leque curto de 3 a 5 datas de atendimento realmente livres. Em cada data, informe o funcionamento daquele dia e sugira 2 ou 3 horários livres; depois pergunte qual opção atende melhor. Não despeje a lista inteira na mensagem.",
    "- Toda data, dia da semana ou horário recusado pelo contato vira uma restrição para o restante da conversa. Passe datas específicas em excludeDates e dias recorrentes em excludeWeekdays; não os ofereça de novo nem insista na mesma opção. Se a pessoa disser que não pode quinta nem sexta, use excludeWeekdays [4, 5] e avance automaticamente para o próximo dia com expediente cadastrado e vaga real.",
    "- Nunca invente data ou hora. Se nenhuma opção pesquisada servir, avance a busca para os dias seguintes com list_available_slots; não volte às datas rejeitadas. Se o contato indicar manhã/tarde/noite, priorize os horários livres desse período e, se não houver, explique e ofereça os mais próximos.",
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
 * Com weekday, usa somente os períodos desse dia. Sem weekday, mantém uma
 * união para consumidores antigos; `listFreeSlots` sempre passa o dia local.
 */
export function slotStartTimes(cfg: ScheduleConfig, weekday?: number): string[] {
  const week = getWeeklyAvailability(cfg);
  const periods = weekday === undefined ? mergeRanges(week.flat()) : week[weekday] ?? [];
  const starts = new Set<number>();
  for (const period of periods) {
    for (let m = period.start; m + cfg.durationMinutes <= period.end; m += cfg.durationMinutes) starts.add(m);
  }
  return [...starts]
    .sort((a, b) => a - b)
    .map(minuteLabel);
}

/** O horário cai dentro do expediente configurado? */
/**
 * Lê a lista de datas bloqueadas. Nunca lança (a linha pode ser antiga, null
 * ou editada à mão) e descarta o que não for uma data real — uma entrada
 * quebrada vira dia sem bloqueio, nunca um dia bloqueado por engano.
 */
export function parseBlockedDates(raw: unknown): BlockedDate[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw
    .flatMap((item) => {
      // Aceita tanto a lista de objetos quanto uma lista de strings simples:
      // gravar só as datas é o formato que a tela usava antes do rótulo.
      const date = typeof item === "string" ? item : (item as Record<string, unknown>)?.date;
      if (!isCalendarDate(date)) return [];
      // Data repetida bloquearia o mesmo dia duas vezes e apareceria duplicada
      // na tela; a primeira vence e leva o rótulo dela.
      if (seen.has(date)) return [];
      seen.add(date);
      const label = typeof item === "object" && item !== null
        ? (item as Record<string, unknown>).label
        : undefined;
      return [{ date, label: typeof label === "string" ? label.trim().slice(0, 60) : "" }];
    })
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, MAX_BLOCKED_DATES);
}

/** `YYYY-MM-DD` do instante no fuso do negócio — o dia de quem atende. */
export function localDateKey(at: Date, timezone: string): string {
  const p = partsInZone(at, timezone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** A data caiu num dia bloqueado (feriado, recesso)? */
export function isBlockedDate(at: Date, cfg: ScheduleConfig): boolean {
  if (cfg.blockedDates.length === 0) return false;
  const key = localDateKey(at, cfg.timezone);
  return cfg.blockedDates.some((blocked) => blocked.date === key);
}

export function isWithinBusinessHours(startsAt: Date, cfg: ScheduleConfig): boolean {
  // Data bloqueada vence a grade: o dia da semana está liberado, mas ESTE dia
  // não. Fica antes da grade porque é a recusa mais barata e mais categórica.
  if (isBlockedDate(startsAt, cfg)) return false;
  const p = partsInZone(startsAt, cfg.timezone);
  const minutes = p.hour * 60 + p.minute;
  const end = minutes + cfg.durationMinutes;
  return getWeeklyAvailability(cfg)[p.weekday]?.some((range) => minutes >= range.start && end <= range.end) ?? false;
}
