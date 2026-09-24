import { prisma } from "@/lib/prisma";

/**
 * Configuração da ação "Follow-up automático", guardada em `TenantAction.config`
 * (chave `follow_up`) — por agente, como toda ação (mesmo padrão de
 * `scheduling/config.ts` para "Agendar horário").
 *
 * São DUAS esteiras, porque "sumiu" e "disse que não" pedem conversas
 * diferentes:
 *
 * - `noReply` — o contato só parou de responder. Começa cedo (30 min) e tem
 *   mensagens no mesmo dia: quem sumiu no meio da conversa costuma ter só se
 *   distraído.
 * - `declined` — o contato disse que não quer agendar agora ("vou pensar",
 *   "agora não dá"). Quem recusou e recebe "ficou alguma dúvida?" 30 minutos
 *   depois se sente cobrado, então aqui o espaço é de dias. Quem troca a
 *   conversa para esta esteira é o agente, pela tool `follow_up`
 *   (`Conversation.followUpReason`).
 *
 * As duas param quando o contato responde ou marca horário.
 */
export type FollowUpStep = {
  /**
   * Minutos de espera antes desta mensagem. Na primeira, contados da última
   * fala do agente, que ficou sem resposta (é o começo do silêncio — e pode ser
   * dias depois da mensagem do contato, quando quem respondeu foi um humano);
   * nas demais, da mensagem anterior da esteira. Contar
   * da anterior (e não do início do silêncio) mantém o espaço entre duas
   * mensagens mesmo quando uma delas esperou a janela de envio abrir — senão
   * uma etapa das 23h e outra das 2h sairiam juntas às 6h.
   */
  delayMinutes: number;
  /** Texto enviado. Com `ai`, é a referência que a IA adapta à conversa. */
  message: string;
  /**
   * A IA reescreve `message` a partir da conversa (retoma o último assunto do
   * contato). Conta uma mensagem na cota do plano — é resposta gerada, como a
   * do atendimento. Sem cota ou sem IA disponível, `message` sai como está.
   */
  ai: boolean;
};

export type FollowUpSequence = {
  /** Desligada, o contato nesta situação não recebe follow-up nenhum. */
  enabled: boolean;
  steps: FollowUpStep[];
};

export type FollowUpSequenceKey = "noReply" | "declined";

export type FollowUpConfig = {
  noReply: FollowUpSequence;
  declined: FollowUpSequence;
  /**
   * Horas do dia (no fuso da agenda do agente) em que o follow-up pode sair:
   * de `startHour` inclusive até `endHour` exclusive. Fora disso a mensagem
   * espera a janela abrir — ninguém quer "oi, sumiu?" às 3h.
   */
  window: { startHour: number; endHour: number };
};

/**
 * Motivo registrado pelo agente (`Conversation.followUpReason`):
 * - `declined` — não quer agendar agora → esteira `declined`;
 * - `stop` — sem interesse / pediu para não receber mensagens → nada é enviado.
 * Sem motivo, vale a esteira `noReply`.
 */
export type FollowUpReason = "declined" | "stop";

export function parseFollowUpReason(raw: unknown): FollowUpReason | null {
  return raw === "declined" || raw === "stop" ? raw : null;
}

/** Teto de cada espera: 30 dias em minutos — acima disso não é mais "follow-up", é outra campanha. */
export const MAX_FOLLOWUP_DELAY_MINUTES = 30 * 24 * 60;

/**
 * Teto de mensagens por esteira. Diferente dos lembretes (sem teto), aqui a
 * pessoa do outro lado NÃO respondeu nenhuma das anteriores — cada mensagem a
 * mais é mais uma chance de a clínica ser marcada como spam.
 */
export const MAX_FOLLOWUP_STEPS = 15;

export const MAX_FOLLOWUP_MESSAGE_LENGTH = 500;

/**
 * Uma etapa que venceu há mais que isto não sai mais. Cobre dois casos em que
 * mandar seria errado: o worker ficou parado e acordaria disparando mensagem
 * atrasada, e a conta que acabou de ligar o follow-up — sem esse limite, toda
 * conversa antiga e silenciosa receberia a primeira mensagem da esteira.
 *
 * Maior que a janela fechada mais longa possível (23h, com janela mínima de
 * 1h) mais a cadência da varredura: uma etapa que caiu às 22h01 ainda sai
 * quando a janela abre no dia seguinte.
 */
export const FOLLOWUP_STALE_AFTER_MINUTES = 26 * 60;

const HOUR = 60;
const DAY = 24 * HOUR;

/**
 * Esteira padrão de quem parou de responder. Em minutos acumulados, é a régua
 * 30 · 210 · 1650 · 2190 · 3630 · 4170 · 5610 · 12810 · 27210 · 41610 — duas
 * mensagens no mesmo dia, depois duas por dia por três dias e espaçando até
 * ~29 dias. Aqui cada uma é guardada como espera desde a anterior.
 *
 * Nada de "bom dia/boa tarde": a etapa pode sair em qualquer hora da janela.
 */
export const DEFAULT_NO_REPLY_STEPS: FollowUpStep[] = [
  {
    delayMinutes: 30,
    ai: true,
    message: "Oi, {{nome}}! Ficou alguma dúvida sobre o que conversamos? Posso te ajudar a encontrar um horário 😊",
  },
  {
    delayMinutes: 3 * HOUR,
    ai: false,
    message: "{{nome}}, conseguiu ver minha última mensagem? Se quiser, já vejo um horário que encaixe na sua rotina.",
  },
  {
    delayMinutes: DAY,
    ai: false,
    message: "Oi, {{nome}}! Passando para saber se ainda tem interesse. Tenho horários nos próximos dias.",
  },
  {
    delayMinutes: 9 * HOUR,
    ai: false,
    message: "Quer que eu reserve um horário para você? É rapidinho, por aqui mesmo.",
  },
  {
    delayMinutes: DAY,
    ai: false,
    message: "{{nome}}, qual período fica melhor para você: manhã ou tarde? Assim já te passo as opções.",
  },
  {
    delayMinutes: 9 * HOUR,
    ai: false,
    message: "Se ficou alguma dúvida sobre como funciona ou sobre valores, me conta que eu te explico.",
  },
  {
    delayMinutes: DAY,
    ai: false,
    message: "Oi, {{nome}}! Sei que a rotina é corrida. Quando quiser retomar, é só me responder aqui.",
  },
  {
    delayMinutes: 5 * DAY,
    ai: false,
    message: "Passando para lembrar que continuo à disposição para agendar seu horário.",
  },
  {
    delayMinutes: 10 * DAY,
    ai: false,
    message: "{{nome}}, ainda tem interesse? Se preferir, posso te chamar mais para frente.",
  },
  {
    delayMinutes: 10 * DAY,
    ai: false,
    message: "Vou encerrar nosso contato por aqui para não te incomodar. Quando quiser agendar, é só mandar uma mensagem 😊",
  },
];

/** Esteira padrão de quem disse que não quer agendar agora: 1, 4, 11 e 26 dias. */
export const DEFAULT_DECLINED_STEPS: FollowUpStep[] = [
  {
    delayMinutes: DAY,
    ai: true,
    message: "Oi, {{nome}}! Tudo bem? Pensou melhor sobre o que conversamos? Se tiver ficado alguma dúvida, estou por aqui.",
  },
  {
    delayMinutes: 3 * DAY,
    ai: false,
    message: "{{nome}}, se fizer sentido para você agora, posso ver um horário que encaixe na sua rotina.",
  },
  {
    delayMinutes: 7 * DAY,
    ai: false,
    message: "Oi, {{nome}}! Passando só para lembrar que continuo à disposição quando quiser agendar.",
  },
  {
    delayMinutes: 15 * DAY,
    ai: false,
    message: "Última mensagem por aqui para não te incomodar 😊 Quando quiser retomar, é só responder.",
  },
];

export const DEFAULT_FOLLOWUP_WINDOW = { startHour: 6, endHour: 22 };

export const DEFAULT_FOLLOWUP_CONFIG: FollowUpConfig = {
  noReply: { enabled: true, steps: DEFAULT_NO_REPLY_STEPS },
  declined: { enabled: true, steps: DEFAULT_DECLINED_STEPS },
  window: DEFAULT_FOLLOWUP_WINDOW,
};

/** Unidades em que a espera é digitada. Guardado sempre em minutos. */
export const FOLLOWUP_UNITS = [
  { value: "minutes", label: "minutos", minutes: 1 },
  { value: "hours", label: "horas", minutes: HOUR },
  { value: "days", label: "dias", minutes: DAY },
] as const;

export type FollowUpUnit = (typeof FOLLOWUP_UNITS)[number]["value"];

/** A maior unidade que representa o valor sem fração: 1440 → 1 dia, 90 → 90 minutos. */
export function splitFollowUpDelay(minutes: number): { amount: number; unit: FollowUpUnit } {
  for (const unit of [...FOLLOWUP_UNITS].reverse()) {
    if (minutes >= unit.minutes && minutes % unit.minutes === 0) {
      return { amount: minutes / unit.minutes, unit: unit.value };
    }
  }
  return { amount: minutes, unit: "minutes" };
}

function validDelay(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 1 && v <= MAX_FOLLOWUP_DELAY_MINUTES
    ? Math.round(v)
    : null;
}

function validMessage(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim().slice(0, MAX_FOLLOWUP_MESSAGE_LENGTH) : null;
}

function parseSteps(raw: unknown): FollowUpStep[] | null {
  if (!Array.isArray(raw)) return null;
  const steps: FollowUpStep[] = [];
  for (const item of raw.slice(0, MAX_FOLLOWUP_STEPS)) {
    const s = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const delayMinutes = validDelay(s.delayMinutes);
    const message = validMessage(s.message);
    // Etapa quebrada é descartada, não corrigida: inventar um intervalo ou um
    // texto para ela seria mandar algo que ninguém escreveu.
    if (delayMinutes === null || message === null) continue;
    steps.push({ delayMinutes, message, ai: s.ai === true });
  }
  return steps.length ? steps : null;
}

function parseSequence(raw: unknown, fallback: FollowUpSequence): FollowUpSequence {
  const s = (raw && typeof raw === "object" ? raw : null) as Record<string, unknown> | null;
  if (!s) return fallback;
  return {
    enabled: typeof s.enabled === "boolean" ? s.enabled : fallback.enabled,
    steps: parseSteps(s.steps) ?? fallback.steps,
  };
}

function parseWindow(raw: unknown): FollowUpConfig["window"] {
  const w = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const start = w.startHour;
  const end = w.endHour;
  if (
    typeof start === "number" && Number.isInteger(start) && start >= 0 && start <= 23 &&
    typeof end === "number" && Number.isInteger(end) && end >= 1 && end <= 24 &&
    start < end
  ) {
    return { startHour: start, endHour: end };
  }
  return DEFAULT_FOLLOWUP_WINDOW;
}

/**
 * Lê o Json cru do banco com default. Nunca lança: config pode ser null (ação
 * recém-criada), de antes deste formato existir, ou editada à mão.
 *
 * **Formato antigo** — uma mensagem só, `{ delayMinutes | delayHours, message }`:
 * vira a esteira "sem resposta" com UMA etapa, o intervalo e o texto que a
 * conta já tinha escolhido (`delayHours` convertido para minutos, preferindo
 * `delayMinutes` quando os dois existem). **Não remova esse fallback** sem
 * migrar as linhas: sem ele, toda conta que salvou o follow-up antigo passaria
 * em silêncio para a esteira padrão de 10 mensagens.
 */
export function parseFollowUpConfig(raw: unknown): FollowUpConfig {
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  if (!("noReply" in c) && !("declined" in c) && ("delayMinutes" in c || "delayHours" in c || "message" in c)) {
    const fromMinutes = validDelay(c.delayMinutes);
    const fromHours =
      typeof c.delayHours === "number" && Number.isFinite(c.delayHours) ? validDelay(c.delayHours * 60) : null;
    const legacyStep: FollowUpStep = {
      delayMinutes: fromMinutes ?? fromHours ?? DAY,
      message: validMessage(c.message) ?? DEFAULT_NO_REPLY_STEPS[0].message,
      ai: false,
    };
    return {
      noReply: { enabled: true, steps: [legacyStep] },
      declined: DEFAULT_FOLLOWUP_CONFIG.declined,
      window: parseWindow(c.window),
    };
  }

  return {
    noReply: parseSequence(c.noReply, DEFAULT_FOLLOWUP_CONFIG.noReply),
    declined: parseSequence(c.declined, DEFAULT_FOLLOWUP_CONFIG.declined),
    window: parseWindow(c.window),
  };
}

/**
 * Regra de escrita que o Zod sozinho não expressa. Devolve a mensagem de erro,
 * ou null. Usada pela tela (antes de enviar) e pela action (antes de gravar).
 *
 * Esteira ligada sem etapa nenhuma é recusada, e não desligada em silêncio:
 * a tela diria "salvo" com a opção ligada que não faz nada — mesma regra de
 * `addToGroup` sem grupo.
 */
export function validateFollowUpConfig(cfg: FollowUpConfig): string | null {
  const sequences: Array<[FollowUpSequence, string]> = [
    [cfg.noReply, "quem para de responder"],
    [cfg.declined, "quem não quer agendar agora"],
  ];
  for (const [seq, who] of sequences) {
    if (seq.enabled && seq.steps.length === 0) {
      return `A esteira de ${who} está ligada sem nenhuma mensagem. Adicione uma ou desligue a esteira.`;
    }
    if (seq.steps.length > MAX_FOLLOWUP_STEPS) {
      return `A esteira de ${who} passa de ${MAX_FOLLOWUP_STEPS} mensagens.`;
    }
    for (const step of seq.steps) {
      if (!Number.isInteger(step.delayMinutes) || step.delayMinutes < 1 || step.delayMinutes > MAX_FOLLOWUP_DELAY_MINUTES) {
        return `Cada espera da esteira de ${who} vai de 1 minuto a ${formatDelay(MAX_FOLLOWUP_DELAY_MINUTES)}.`;
      }
      if (!step.message.trim()) return `Toda mensagem da esteira de ${who} precisa de texto.`;
    }
  }
  const { startHour, endHour } = cfg.window;
  if (!(startHour >= 0 && startHour <= 23 && endHour >= 1 && endHour <= 24 && startHour < endHour)) {
    return "O horário de envio precisa terminar depois de começar.";
  }
  return null;
}

/** Soma das esperas até cada etapa: quanto tempo de silêncio ela representa. */
export function cumulativeDelays(steps: FollowUpStep[]): number[] {
  let total = 0;
  return steps.map((s) => (total += s.delayMinutes));
}

function describeSequence(seq: FollowUpSequence): string {
  if (!seq.enabled) return "desligado";
  const n = seq.steps.length;
  const last = cumulativeDelays(seq.steps)[n - 1] ?? 0;
  return n === 1
    ? `1 mensagem após ${formatDelay(last)}`
    : `${n} mensagens em ${formatDelay(last)}`;
}

/** Resumo em uma linha — usado no card da ação, fechado. */
export function describeFollowUp(cfg: FollowUpConfig): string {
  return `sem resposta: ${describeSequence(cfg.noReply)} · não quer agendar: ${describeSequence(cfg.declined)}`;
}

/**
 * "90 minutos", "3h30min", "1 dia e 3h30min", "28 dias".
 *
 * Exportada porque o formulário mostra a mesma frase enquanto a pessoa digita:
 * duas implementações da mesma conta divergiriam na primeira vez que alguém
 * ajustasse o arredondamento de um lado só.
 */
export function formatDelay(minutes: number): string {
  if (minutes < HOUR) return `${minutes} minuto${minutes === 1 ? "" : "s"}`;
  if (minutes < DAY) {
    const hours = Math.floor(minutes / HOUR);
    const rest = minutes % HOUR;
    return rest ? `${hours}h${rest}min` : `${hours}h`;
  }
  const days = Math.floor(minutes / DAY);
  const rest = minutes % DAY;
  const dayLabel = `${days} dia${days === 1 ? "" : "s"}`;
  return rest ? `${dayLabel} e ${formatDelay(rest)}` : dayLabel;
}

/** "6h às 22h". */
export function describeWindow(window: FollowUpConfig["window"]): string {
  return `${window.startHour}h às ${window.endHour}h`;
}

/** Config de follow-up do agente (ou o padrão, se a ação nunca foi tocada). */
export async function getFollowUpConfig(agentId: string): Promise<FollowUpConfig> {
  const action = await prisma.tenantAction.findUnique({
    where: { agentId_key: { agentId, key: "follow_up" } },
    select: { config: true },
  });
  return parseFollowUpConfig(action?.config);
}

export async function saveFollowUpConfig(
  tenantId: string,
  agentId: string,
  config: FollowUpConfig,
): Promise<void> {
  await prisma.tenantAction.upsert({
    where: { agentId_key: { agentId, key: "follow_up" } },
    // Salvar a esteira não liga a ação sozinha — quem liga é o toggle.
    create: { tenantId, agentId, key: "follow_up", enabled: false, config },
    update: { config },
  });
}
