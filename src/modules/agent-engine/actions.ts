// Catálogo de "ações" (tools) que o agente pode executar. Genérico — nada
// específico de um segmento. O motor (Milestone 5) expõe as ativas como
// function-calling ao LLM e roteia para os handlers.
export type ActionKey =
  | "register_lead"
  | "mark_hot_lead"
  | "schedule_meeting"
  | "follow_up"
  | "handoff_human";

export type ActionDef = {
  key: ActionKey;
  label: string;
  description: string;
  // ready = integrada; stub = mock por enquanto (sem integração real);
  // disabled = fora do ar temporariamente (não aparece na UI nem no motor).
  status: "ready" | "stub" | "disabled";
  /** O que o cliente vê acontecer quando o agente usa isto. */
  outcome?: string;
  /** Ação com configuração própria: a UI mostra o painel junto do toggle. */
  configurable?: boolean;
};

export const ACTION_CATALOG: ActionDef[] = [
  {
    key: "register_lead",
    label: "Registrar lead",
    description: "Salva nome, telefone e interesse do contato no banco.",
    status: "disabled",
  },
  {
    key: "mark_hot_lead",
    label: "Marcar lead quente + notificar",
    description: "Marca o lead como quente e dispara uma notificação simples.",
    status: "disabled",
  },
  {
    key: "schedule_meeting",
    label: "Agendar horário",
    description:
      "O agente combina data e hora com o contato, dentro do seu horário de atendimento.",
    outcome: "O horário aparece na sua Agenda e o contato vira “agendado”.",
    status: "ready",
    configurable: true,
  },
  {
    key: "follow_up",
    label: "Follow-up automático",
    description: "Reengaja o contato depois de quantas horas você definir, sem resposta.",
    outcome: "O agente manda uma mensagem sozinho se o contato sumir.",
    status: "ready",
    configurable: true,
  },
  {
    key: "handoff_human",
    label: "Transferir para humano",
    description: "Marca a conversa como 'precisa atenção' para um humano assumir.",
    outcome: "A conversa aparece em Conversas › “Precisa de você”.",
    status: "ready",
    configurable: true,
  },
];

export const ACTION_BY_KEY = Object.fromEntries(ACTION_CATALOG.map((a) => [a.key, a])) as Record<
  ActionKey,
  ActionDef
>;

/** Ações que o produto oferece agora (exclui as desativadas temporariamente). */
export const AVAILABLE_ACTIONS = ACTION_CATALOG.filter((a) => a.status !== "disabled");

export function isActionAvailable(key: string): boolean {
  return ACTION_BY_KEY[key as ActionKey]?.status !== "disabled";
}
