import { prisma } from "@/lib/prisma";

/**
 * Configuração da ação "Follow-up automático", guardada em `TenantAction.config`
 * (chave `follow_up`) — por agente, como toda ação (mesmo padrão de
 * `scheduling/config.ts` para "Agendar horário").
 */
export type FollowUpConfig = {
  /** Horas de silêncio do lead, depois da última mensagem do agente, antes de reengajar. */
  delayHours: number;
  /** Texto que o agente manda sozinho ao reengajar. */
  message: string;
};

export const DEFAULT_FOLLOWUP_MESSAGE =
  "Oi! Vi que nossa conversa ficou pela metade 😊 Posso te ajudar em mais alguma coisa?";

export const DEFAULT_FOLLOWUP_CONFIG: FollowUpConfig = {
  delayHours: 24,
  message: DEFAULT_FOLLOWUP_MESSAGE,
};

/**
 * Lê o Json cru do banco com default. Nunca lança: config pode ser null (ação
 * recém-criada), de antes deste campo existir, ou editada à mão.
 */
export function parseFollowUpConfig(raw: unknown): FollowUpConfig {
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const delayHours =
    typeof c.delayHours === "number" && c.delayHours >= 1 && c.delayHours <= 720
      ? Math.round(c.delayHours)
      : DEFAULT_FOLLOWUP_CONFIG.delayHours;
  const message =
    typeof c.message === "string" && c.message.trim().length > 0
      ? c.message.trim().slice(0, 500)
      : DEFAULT_FOLLOWUP_CONFIG.message;
  return { delayHours, message };
}

/** Resumo em uma linha — usado no card da ação, fechado. */
export function describeFollowUp(cfg: FollowUpConfig): string {
  return `reengaja após ${cfg.delayHours}h de silêncio do lead`;
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
