import { prisma } from "@/lib/prisma";
import { getWhatsAppProvider } from "@/modules/whatsapp";

/**
 * Configuração da ação "Transferir para humano", guardada em `TenantAction.config`
 * (chave `handoff_human`) — mesmo padrão de `follow-up/config.ts` para
 * "Follow-up automático" e `scheduling/config.ts` para "Agendar horário".
 *
 * Quando `addToGroup` está ligado, o contato é adicionado a um grupo fixo do
 * WhatsApp (cadastrado aqui pelo `groupId`) no momento em que a conversa vira
 * "precisa de você" — reação com emoji, mensagem só de emoji, ou a tool
 * `handoff_human` chamada pelo agente. O grupo é o mesmo para toda transferência
 * deste agente (não um grupo novo por atendimento): normalmente é o grupo onde
 * a equipe de atendimento já está.
 */
export type HandoffConfig = {
  /** Adicionar o contato a um grupo do WhatsApp ao transferir para humano. */
  addToGroup: boolean;
  /** JID do grupo (`...@g.us`) — obtido no WhatsApp em Info do grupo › copiar ID. */
  groupId: string | null;
};

export const DEFAULT_HANDOFF_CONFIG: HandoffConfig = {
  addToGroup: false,
  groupId: null,
};

/** Aceita o JID completo (`120363...@g.us`) ou só os dígitos, e normaliza. */
export function normalizeGroupId(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withSuffix = trimmed.endsWith("@g.us") ? trimmed : `${trimmed}@g.us`;
  const digits = withSuffix.slice(0, -"@g.us".length);
  // JID de grupo é dígitos, opcionalmente com "-" (grupos antigos da Evolution).
  if (!/^\d[\d-]*$/.test(digits)) return null;
  return withSuffix;
}

/**
 * Lê o Json cru do banco com default. Nunca lança: config pode ser null (ação
 * recém-criada), de antes deste campo existir, ou editada à mão.
 */
export function parseHandoffConfig(raw: unknown): HandoffConfig {
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const groupId =
    typeof c.groupId === "string" ? normalizeGroupId(c.groupId) : null;
  return {
    // Sem grupo cadastrado, a opção não pode estar ligada — evita um toggle
    // "ligado" que na prática não adiciona ninguém a lugar nenhum.
    addToGroup: typeof c.addToGroup === "boolean" && c.addToGroup && Boolean(groupId),
    groupId,
  };
}

/** Resumo em uma linha — usado no card da ação, fechado. */
export function describeHandoff(cfg: HandoffConfig): string {
  return cfg.addToGroup && cfg.groupId
    ? "também adiciona o contato a um grupo do WhatsApp"
    : "marca a conversa como “precisa de você”";
}

/** Config de transferência do agente (ou o padrão, se a ação nunca foi tocada). */
export async function getHandoffConfig(agentId: string): Promise<HandoffConfig> {
  const action = await prisma.tenantAction.findUnique({
    where: { agentId_key: { agentId, key: "handoff_human" } },
    select: { config: true },
  });
  return parseHandoffConfig(action?.config);
}

/**
 * A config **e** se a ação está ligada. Separada de `getHandoffConfig` (que a
 * tela usa para preencher o formulário mesmo com a ação desligada — desligar
 * não pode apagar o que foi configurado) porque quem vai AGIR precisa das duas
 * respostas: uma ação desligada não adiciona ninguém a grupo nenhum.
 */
async function getActiveHandoffConfig(agentId: string): Promise<HandoffConfig | null> {
  const action = await prisma.tenantAction.findUnique({
    where: { agentId_key: { agentId, key: "handoff_human" } },
    select: { enabled: true, config: true },
  });
  if (!action?.enabled) return null;
  return parseHandoffConfig(action.config);
}

export async function saveHandoffConfig(
  tenantId: string,
  agentId: string,
  config: HandoffConfig,
): Promise<void> {
  await prisma.tenantAction.upsert({
    where: { agentId_key: { agentId, key: "handoff_human" } },
    // Salvar a config não liga a ação sozinha — quem liga é o toggle.
    create: { tenantId, agentId, key: "handoff_human", enabled: false, config },
    update: { config },
  });
}

/**
 * Adiciona o lead ao grupo de atendimento do agente, se a ação "Transferir
 * para humano" estiver LIGADA e configurada para isso. Chamado nos três lugares
 * onde uma conversa vira "precisa de você": a tool `handoff_human`, a reação
 * com emoji e a mensagem só de emoji (ambas no webhook do WhatsApp).
 *
 * **Nunca lança**, e por isso o `try` cobre as consultas ao banco também, não
 * só a chamada de rede. Mesma regra do resto de `scheduling`/`voice`: nada aqui
 * pode impedir a transferência para humano de acontecer — a conversa já foi
 * marcada `needsHuman`, e é isso que importa. No webhook, deixar escapar uma
 * exceção seria pior que perder o grupo: a rota devolveria 500 e a Evolution
 * reentregaria a mesma mensagem em laço.
 *
 * **Conversa de teste não entra** (`isTest`): o sandbox usa um telefone
 * sintético, e adicioná-lo a um grupo de verdade poluiria o grupo da equipe com
 * um número que não existe — mesma regra do worker de follow-up e do envio de
 * resposta, que também não falam com o WhatsApp em teste.
 */
export async function addLeadToHandoffGroup(
  tenantId: string,
  agentId: string | null,
  phone: string,
  options: { isTest?: boolean } = {},
): Promise<void> {
  if (!agentId || options.isTest) return;

  try {
    const config = await getActiveHandoffConfig(agentId);
    if (!config?.addToGroup || !config.groupId) return;

    const instance = await prisma.whatsappInstance.findUnique({
      where: { tenantId },
      select: { externalId: true, status: true },
    });
    if (!instance?.externalId || instance.status !== "connected") return;

    await getWhatsAppProvider().addParticipantToGroup(instance.externalId, config.groupId, phone);
  } catch (err) {
    console.error("[handoff] falha ao adicionar contato ao grupo do WhatsApp", err);
  }
}
