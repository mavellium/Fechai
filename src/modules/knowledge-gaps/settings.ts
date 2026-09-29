import { TIMEZONES } from "@/modules/scheduling/time";

/**
 * Regra e avisos da fila de perguntas sem resposta, por conta
 * (`KnowledgeGapSettings`). Puro de propósito: a tela importa daqui.
 *
 * Não é config de ação (`TenantAction.config`): registrar pergunta sem
 * resposta não é uma habilidade do catálogo e não pode comer vaga do plano —
 * mesma lição dos lembretes. Vale para a conta toda, como `CalendarFeatures`.
 */

/** O que acontece com a conversa quando o agente não sabe responder. */
export type GapMode = "keep" | "handoff";
/** Quem responde a fila da conta — decisão da Mavellium com o cliente. */
export type GapResponders = "clinic" | "mavellium" | "both";

export type GapSettings = {
  onUnanswered: GapMode;
  notifyEmail: boolean;
  notifyWhatsapp: boolean;
  groupId: string | null;
  groupName: string | null;
  /** Um aviso por pergunta NOVA (repetição não avisa de novo). */
  immediate: boolean;
  dailyDigest: boolean;
  /** Hora local (0–23) do resumo diário. */
  digestHour: number;
  timezone: string;
  responders: GapResponders;
};

export const DEFAULT_GAP_SETTINGS: GapSettings = {
  onUnanswered: "keep",
  notifyEmail: true,
  notifyWhatsapp: false,
  groupId: null,
  groupName: null,
  immediate: true,
  dailyDigest: true,
  digestHour: 8,
  timezone: "America/Sao_Paulo",
  responders: "clinic",
};

export const GAP_MODES: { value: GapMode; label: string; hint: string }[] = [
  {
    value: "keep",
    label: "Continuar atendendo",
    hint: "O agente avisa que vai confirmar com a equipe e segue a conversa. A pergunta vai para a fila.",
  },
  {
    value: "handoff",
    label: "Passar para a equipe",
    hint: "Além da fila, a conversa vai para “Precisa de você” e o grupo de transferência é avisado, se estiver ligado.",
  },
];

export const GAP_RESPONDERS: { value: GapResponders; label: string }[] = [
  { value: "clinic", label: "Clínica" },
  { value: "mavellium", label: "Mavellium" },
  { value: "both", label: "As duas" },
];

const isMode = (v: unknown): v is GapMode => v === "keep" || v === "handoff";
const isResponders = (v: unknown): v is GapResponders => v === "clinic" || v === "mavellium" || v === "both";

/** Lê a linha do banco (ou a ausência dela). Nunca lança: valor estranho cai no padrão. */
export function parseGapSettings(row: Partial<Record<keyof GapSettings, unknown>> | null | undefined): GapSettings {
  const r = row ?? {};
  const groupId = typeof r.groupId === "string" && r.groupId.trim() ? r.groupId.trim() : null;
  const hour = typeof r.digestHour === "number" && Number.isInteger(r.digestHour) ? r.digestHour : DEFAULT_GAP_SETTINGS.digestHour;
  return {
    onUnanswered: isMode(r.onUnanswered) ? r.onUnanswered : DEFAULT_GAP_SETTINGS.onUnanswered,
    notifyEmail: typeof r.notifyEmail === "boolean" ? r.notifyEmail : DEFAULT_GAP_SETTINGS.notifyEmail,
    // Mesma regra do grupo da transferência: ligado sem grupo não existe.
    notifyWhatsapp: r.notifyWhatsapp === true && Boolean(groupId),
    groupId,
    groupName: groupId && typeof r.groupName === "string" && r.groupName.trim() ? r.groupName.trim().slice(0, 100) : null,
    immediate: typeof r.immediate === "boolean" ? r.immediate : DEFAULT_GAP_SETTINGS.immediate,
    dailyDigest: typeof r.dailyDigest === "boolean" ? r.dailyDigest : DEFAULT_GAP_SETTINGS.dailyDigest,
    digestHour: hour >= 0 && hour <= 23 ? hour : DEFAULT_GAP_SETTINGS.digestHour,
    timezone: typeof r.timezone === "string" && TIMEZONES.some((z) => z.value === r.timezone)
      ? r.timezone : DEFAULT_GAP_SETTINGS.timezone,
    responders: isResponders(r.responders) ? r.responders : DEFAULT_GAP_SETTINGS.responders,
  };
}

/** A clínica (quem usa o painel da conta) pode responder e aprovar? */
export const clinicAnswers = (r: GapResponders) => r !== "mavellium";
/** A Mavellium (superadmin, com dados mascarados) pode responder e aprovar? */
export const mavelliumAnswers = (r: GapResponders) => r !== "clinic";

/** Resumo de uma linha dos avisos, para o card fechado. */
export function describeGapNotices(s: GapSettings): string {
  const channels = [s.notifyEmail && "e-mail", s.notifyWhatsapp && "grupo do WhatsApp"].filter(Boolean);
  if (!channels.length || (!s.immediate && !s.dailyDigest)) return "sem avisos — confira a fila por aqui";
  const when = [s.immediate && "a cada pergunta nova", s.dailyDigest && `resumo diário às ${String(s.digestHour).padStart(2, "0")}h`]
    .filter(Boolean).join(" e ");
  return `${channels.join(" e ")}: ${when}`;
}
