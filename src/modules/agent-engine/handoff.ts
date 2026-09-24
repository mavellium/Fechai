import { prisma } from "@/lib/prisma";
import {
  getWhatsAppProviderForInstance,
  WHATSAPP_PROVIDER_SELECT,
} from "@/modules/whatsapp/meta-config";
import type { WhatsAppGroup } from "@/modules/whatsapp/provider";

/**
 * Configuração da ação "Transferir para humano", guardada em `TenantAction.config`
 * (chave `handoff_human`) — mesmo padrão de `follow-up/config.ts` para
 * "Follow-up automático" e `scheduling/config.ts` para "Agendar horário".
 *
 * Quando `addToGroup` está ligado, o contato é adicionado a um grupo fixo do
 * WhatsApp (cadastrado aqui pelo `groupId`) no momento em que a conversa vira
 * "precisa de você" — reação do atendente ou a tool `handoff_human` chamada
 * pelo agente. O grupo é o mesmo para toda transferência
 * deste agente (não um grupo novo por atendimento): normalmente é o grupo onde
 * a equipe de atendimento já está.
 */
export type HandoffConfig = {
  /** Adicionar o contato a um grupo do WhatsApp ao transferir para humano. */
  addToGroup: boolean;
  /** JID do grupo (`...@g.us`), escolhido na lista de grupos do número ou colado à mão. */
  groupId: string | null;
  /** Nome do grupo quando foi escolhido na lista. Só exibição: quem vale é o `groupId`. */
  groupName: string | null;
  /**
   * Quando o agente deve transferir e mandar o contato para o grupo, nas
   * palavras do dono da conta. Vai para a descrição da tool `handoff_human`
   * (`handoffToolDescription`). Vazio: o agente decide sozinho, como antes.
   */
  groupReason: string;
};

export const MAX_GROUP_NAME = 100;
export const MAX_GROUP_REASON = 500;

export const DEFAULT_HANDOFF_CONFIG: HandoffConfig = {
  addToGroup: false,
  groupId: null,
  groupName: null,
  groupReason: "",
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
  const groupName =
    groupId && typeof c.groupName === "string" && c.groupName.trim()
      ? c.groupName.trim().slice(0, MAX_GROUP_NAME)
      : null;
  return {
    // Sem grupo cadastrado, a opção não pode estar ligada — evita um toggle
    // "ligado" que na prática não adiciona ninguém a lugar nenhum.
    addToGroup: typeof c.addToGroup === "boolean" && c.addToGroup && Boolean(groupId),
    groupId,
    groupName,
    groupReason:
      typeof c.groupReason === "string" ? c.groupReason.trim().slice(0, MAX_GROUP_REASON) : "",
  };
}

/** Resumo em uma linha — usado no card da ação, fechado. */
export function describeHandoff(cfg: HandoffConfig): string {
  if (!cfg.addToGroup || !cfg.groupId) return "marca a conversa como “precisa de você”";
  return cfg.groupName
    ? `também adiciona o contato ao grupo “${cfg.groupName}”`
    : "também adiciona o contato a um grupo do WhatsApp";
}

const HANDOFF_TOOL_BASE = "Transfere a conversa para um atendente humano.";

/**
 * Descrição da tool `handoff_human` que o LLM lê. É por ela que o motivo
 * escrito pelo dono chega ao agente: sem isso, "quando mandar para o grupo"
 * dependia de alguém lembrar de repetir a regra na persona.
 *
 * "Use sempre que" e não "use só quando": o motivo acrescenta um gatilho, não
 * proíbe os outros — quem pede para falar com uma pessoa continua sendo
 * transferido. Só vale com o grupo ligado, porque o campo mora dentro dessa
 * opção na tela; desligada, o texto fica guardado e sem efeito.
 */
export function handoffToolDescription(cfg?: HandoffConfig): string {
  if (!cfg?.addToGroup || !cfg.groupId || !cfg.groupReason) return HANDOFF_TOOL_BASE;
  const reason = cfg.groupReason.replace(/\s+/g, " ").replace(/[\s.;]+$/, "");
  return `${HANDOFF_TOOL_BASE} Use sempre que: ${reason}. Ao transferir, o contato também é adicionado ao grupo de atendimento da equipe no WhatsApp.`;
}

export type GroupListResult =
  | { ok: true; groups: WhatsAppGroup[] }
  | {
      ok: false;
      /**
       * `unsupported`: a conexão não tem grupos (Meta) — colar o ID não
       * adiantaria. Os outros dois são passageiros, e a tela oferece o ID à mão.
       */
      reason: "unsupported" | "disconnected" | "failed";
      error: string;
    };

/**
 * Grupos do número conectado, para a tela da transferência. **Nunca lança**:
 * a lista é conveniência — Evolution fora do ar não pode impedir de salvar a
 * transferência, só obriga a colar o ID.
 */
export async function listWhatsAppGroups(tenantId: string): Promise<GroupListResult> {
  try {
    const instance = await prisma.whatsappInstance.findUnique({
      where: { tenantId },
      select: { status: true, ...WHATSAPP_PROVIDER_SELECT },
    });
    if (!instance?.externalId || instance.status !== "connected") {
      return {
        ok: false,
        reason: "disconnected",
        error: "O WhatsApp não está conectado, então não dá para listar os grupos agora.",
      };
    }
    const provider = getWhatsAppProviderForInstance(instance);
    if (!provider.listGroups) {
      return {
        ok: false,
        reason: "unsupported",
        error:
          "Esta conta está conectada pela API oficial da Meta, que não dá acesso a grupos. Adicionar o contato a um grupo só funciona com o número conectado por QR code.",
      };
    }
    if (!provider.isConfigured()) {
      return { ok: false, reason: "failed", error: "Não foi possível buscar os grupos do WhatsApp agora." };
    }
    return { ok: true, groups: await provider.listGroups(instance.externalId) };
  } catch (err) {
    console.error("[handoff] falha ao listar grupos do WhatsApp", err);
    return { ok: false, reason: "failed", error: "Não foi possível buscar os grupos do WhatsApp agora." };
  }
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
 * para humano" estiver LIGADA e configurada para isso. Chamado quando a tool
 * `handoff_human` transfere a conversa ou quando o atendente reage pelo próprio
 * número do WhatsApp para assumi-la.
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
      select: { status: true, ...WHATSAPP_PROVIDER_SELECT },
    });
    if (!instance?.externalId || instance.status !== "connected") return;

    await getWhatsAppProviderForInstance(instance).addParticipantToGroup(
      instance.externalId,
      config.groupId,
      phone,
    );
  } catch (err) {
    console.error("[handoff] falha ao adicionar contato ao grupo do WhatsApp", err);
  }
}
