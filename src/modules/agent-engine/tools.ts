import { prisma } from "@/lib/prisma";
import type { LlmToolSchema } from "@/modules/ai";
import { ACTION_BY_KEY, type ActionKey } from "./actions";

export type ToolContext = { tenantId: string; leadId: string; conversationId: string };
type Handler = (ctx: ToolContext, args: Record<string, unknown>) => Promise<string>;

type ToolDef = { schema: LlmToolSchema; handler: Handler };

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

// Definições das tools por ação. O orquestrador expõe ao LLM só as ativas.
export function getToolSchemas(activeKeys: string[]): LlmToolSchema[] {
  return activeKeys
    // Desativadas temporariamente não são expostas ao LLM mesmo se o tenant
    // ainda tiver a linha enabled no banco.
    .filter((k) => ACTION_BY_KEY[k as ActionKey]?.status !== "disabled")
    .map((k) => TOOLS[k as ActionKey]?.schema)
    .filter((s): s is LlmToolSchema => Boolean(s));
}

export async function runToolHandler(
  key: string,
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<string> {
  const tool = TOOLS[key as ActionKey];
  if (!tool) return `Ação desconhecida: ${key}`;
  if (ACTION_BY_KEY[key as ActionKey]?.status === "disabled") {
    return "Ação desativada por enquanto.";
  }
  try {
    return await tool.handler(ctx, args);
  } catch (err) {
    console.error(`[tools] falha em ${key}`, err);
    return `Falha ao executar ${key}.`;
  }
}

const TOOLS: Record<ActionKey, ToolDef> = {
  register_lead: {
    schema: {
      name: "register_lead",
      description: "Registra/atualiza os dados do lead (nome e interesse).",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Nome do contato" },
          interest: { type: "string", description: "Interesse/produto mencionado" },
        },
      },
    },
    handler: async (ctx, args) => {
      const name = str(args.name);
      await prisma.lead.update({
        where: { id: ctx.leadId },
        data: { ...(name ? { name } : {}), status: "warm" },
      });
      return `Lead registrado${name ? ` (${name})` : ""}.`;
    },
  },

  mark_hot_lead: {
    schema: {
      name: "mark_hot_lead",
      description: "Marca o lead como quente quando o interesse de compra é alto.",
      parameters: {
        type: "object",
        properties: { reason: { type: "string", description: "Motivo" } },
      },
    },
    handler: async (ctx, args) => {
      await prisma.lead.update({ where: { id: ctx.leadId }, data: { status: "hot" } });
      // Notificação simples (stub): trocar por e-mail/webhook real depois.
      console.log(`[notify] lead quente ${ctx.leadId} tenant ${ctx.tenantId}: ${str(args.reason) ?? ""}`);
      return "Lead marcado como quente e time notificado.";
    },
  },

  schedule_meeting: {
    schema: {
      name: "schedule_meeting",
      description: "Agenda um horário com o contato (mock — sem calendário real ainda).",
      parameters: {
        type: "object",
        properties: {
          datetime: { type: "string", description: "Data/hora combinada (texto livre)" },
        },
        required: ["datetime"],
      },
    },
    handler: async (ctx, args) => {
      await prisma.lead.update({ where: { id: ctx.leadId }, data: { status: "scheduled" } });
      const when = str(args.datetime) ?? "horário combinado";
      return `Agendamento registrado para ${when} (mock).`;
    },
  },

  follow_up: {
    schema: {
      name: "follow_up",
      description: "Programa um follow-up automático caso o contato não responda.",
      parameters: {
        type: "object",
        properties: { hours: { type: "number", description: "Horas até o follow-up" } },
      },
    },
    handler: async (ctx) => {
      // O disparo real é do worker (Milestone 6); aqui só sinalizamos.
      await prisma.conversation.update({
        where: { id: ctx.conversationId },
        data: { followUpSentAt: null },
      });
      return "Follow-up automático programado.";
    },
  },

  handoff_human: {
    schema: {
      name: "handoff_human",
      description: "Transfere a conversa para um atendente humano.",
      parameters: {
        type: "object",
        properties: { reason: { type: "string", description: "Motivo do repasse" } },
      },
    },
    handler: async (ctx) => {
      await prisma.conversation.update({
        where: { id: ctx.conversationId },
        data: { needsHuman: true },
      });
      return "Conversa marcada como 'precisa atenção' de um humano.";
    },
  },
};
