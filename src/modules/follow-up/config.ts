import { prisma } from "@/lib/prisma";

/**
 * Configuração da ação "Follow-up automático", guardada em `TenantAction.config`
 * (chave `follow_up`) — por agente, como toda ação (mesmo padrão de
 * `scheduling/config.ts` para "Agendar horário").
 */
export type FollowUpConfig = {
  /**
   * Minutos de silêncio do lead, depois da última mensagem do agente, antes de
   * reengajar. Guardado em minutos (não horas) para caber também intervalos
   * curtos — um follow-up de "15 minutos depois" é comum em vendas rápidas, e
   * arredondar para 1h já dobraria a espera real. A UI (`FollowUpSettings`)
   * deixa escolher o número em minutos OU horas; os dois convertem para isto
   * antes de salvar.
   */
  delayMinutes: number;
  /** Texto que o agente manda sozinho ao reengajar. */
  message: string;
};

export const DEFAULT_FOLLOWUP_MESSAGE =
  "Oi! Vi que nossa conversa ficou pela metade 😊 Posso te ajudar em mais alguma coisa?";

/** Teto do intervalo: 30 dias em minutos — acima disso não é mais "follow-up", é outra campanha. */
export const MAX_FOLLOWUP_DELAY_MINUTES = 30 * 24 * 60;

export const DEFAULT_FOLLOWUP_CONFIG: FollowUpConfig = {
  delayMinutes: 24 * 60,
  message: DEFAULT_FOLLOWUP_MESSAGE,
};

/**
 * Lê o Json cru do banco com default. Nunca lança: config pode ser null (ação
 * recém-criada), de antes deste campo existir, ou editada à mão.
 *
 * Aceita `delayMinutes` (formato atual) e, para configs salvas antes desta
 * mudança, `delayHours` — convertido na leitura para não perder o intervalo
 * que a conta já tinha escolhido.
 */
export function parseFollowUpConfig(raw: unknown): FollowUpConfig {
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const fromMinutes =
    typeof c.delayMinutes === "number" && Number.isFinite(c.delayMinutes) ? c.delayMinutes : null;
  const fromHours =
    typeof c.delayHours === "number" && Number.isFinite(c.delayHours) ? c.delayHours * 60 : null;
  const raw_ = fromMinutes ?? fromHours;
  const delayMinutes =
    raw_ !== null && raw_ >= 1 && raw_ <= MAX_FOLLOWUP_DELAY_MINUTES
      ? Math.round(raw_)
      : DEFAULT_FOLLOWUP_CONFIG.delayMinutes;
  const message =
    typeof c.message === "string" && c.message.trim().length > 0
      ? c.message.trim().slice(0, 500)
      : DEFAULT_FOLLOWUP_CONFIG.message;
  return { delayMinutes, message };
}

/** Resumo em uma linha — usado no card da ação, fechado. */
export function describeFollowUp(cfg: FollowUpConfig): string {
  return `reengaja após ${formatDelay(cfg.delayMinutes)} de silêncio do lead`;
}

/**
 * "90 minutos" para intervalos curtos, "6h" a partir de uma hora cheia.
 *
 * Exportada porque o formulário mostra a mesma frase enquanto a pessoa digita
 * ("= 1h30min de silêncio"): duas implementações da mesma conta divergiriam na
 * primeira vez que alguém ajustasse o arredondamento de um lado só.
 */
export function formatDelay(minutes: number): string {
  if (minutes < 60) return `${minutes} minuto${minutes === 1 ? "" : "s"}`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${minutes % 60}min`;
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
    // Salvar o intervalo não liga a ação sozinha — quem liga é o toggle.
    create: { tenantId, agentId, key: "follow_up", enabled: false, config },
    update: { config },
  });
}
