import { prisma } from "@/lib/prisma";
import type { LlmToolSchema } from "@/modules/ai";
import { isWithinBusinessHours } from "@/modules/scheduling/config";
import {
  createAppointment,
  findOwnAppointment,
  getScheduleConfig,
  hasConflictAnywhere,
} from "@/modules/scheduling/repository";
import { formatInZone, parseLocalDateTime } from "@/modules/scheduling/time";
import { ACTION_BY_KEY, type ActionKey } from "./actions";

export type ToolContext = {
  tenantId: string;
  leadId: string;
  conversationId: string;
  /** Quem está atendendo — a agenda e a config de horário são por agente. */
  agentId: string | null;
};
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
      description:
        "Marca um horário com o contato na agenda do negócio. Use somente depois de ter uma data e uma hora exatas — converta você mesmo expressões como 'amanhã de tarde' antes de chamar.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Data no formato AAAA-MM-DD" },
          time: { type: "string", description: "Hora de início no formato HH:MM (24h)" },
          title: { type: "string", description: "Assunto do horário. Ex: 'Aula experimental'" },
          notes: { type: "string", description: "Observações combinadas na conversa" },
        },
        required: ["date", "time"],
      },
    },
    /**
     * Antes isto era um mock: trocava o status do lead e devolvia "(mock)" — a
     * data combinada não ia para lugar nenhum. Agora grava um `Appointment` de
     * verdade, respeita o expediente configurado na ação e espelha no Google
     * Agenda quando a conta está conectada.
     *
     * As recusas voltam como texto para o LLM de propósito: ele reaproveita o
     * motivo para propor outro horário ao contato no mesmo turno.
     */
    handler: async (ctx, args) => {
      if (!ctx.agentId) return "Não foi possível agendar agora. Ofereça falar com um atendente.";

      const cfg = await getScheduleConfig(ctx.agentId);
      const date = str(args.date);
      const time = str(args.time);
      if (!date || !time) return "Faltou a data ou a hora. Pergunte ao contato e tente de novo.";

      const startsAt = parseLocalDateTime(date, time, cfg.timezone);
      if (!startsAt) return "Data ou hora inválida. Use AAAA-MM-DD e HH:MM.";

      const noticeMs = cfg.minNoticeHours * 3_600_000;
      if (startsAt.getTime() < Date.now() + noticeMs) {
        return cfg.minNoticeHours > 0
          ? `Esse horário é cedo demais: precisamos de ${cfg.minNoticeHours}h de antecedência. Proponha um horário mais para frente.`
          : "Esse horário já passou. Proponha um horário futuro.";
      }

      if (!isWithinBusinessHours(startsAt, cfg)) {
        return `Fora do horário de atendimento (${cfg.startTime} às ${cfg.endTime}). Proponha outro horário dentro do expediente.`;
      }

      const endsAt = new Date(startsAt.getTime() + cfg.durationMinutes * 60_000);

      // O LLM pode chamar de novo pra "confirmar" um horário que ele mesmo já
      // marcou nesta conversa — trata como sucesso (idempotente) em vez de
      // bater no conflito contra o próprio agendamento e entrar em loop.
      const own = await findOwnAppointment(ctx.conversationId, startsAt, endsAt);
      if (own) {
        const when = formatInZone(own.startsAt, cfg.timezone);
        return `Esse horário já está confirmado para ${when}${cfg.location ? ` (${cfg.location})` : ""}. Não é necessário marcar de novo — apenas confirme com o contato.`;
      }

      // Olha a nossa agenda E a do Clinicorp, quando conectado: a recepção
      // marca paciente direto no sistema da clínica e esses horários nunca
      // passaram por aqui.
      if (await hasConflictAnywhere(ctx.tenantId, startsAt, endsAt, cfg.timezone)) {
        return "Já existe um compromisso nesse horário. Ofereça outro horário ao contato.";
      }

      const lead = await prisma.lead.findUnique({
        where: { id: ctx.leadId },
        select: { name: true, phone: true },
      });
      const who = lead?.name || lead?.phone || "contato";

      await createAppointment({
        tenantId: ctx.tenantId,
        agentId: ctx.agentId,
        leadId: ctx.leadId,
        conversationId: ctx.conversationId,
        title: str(args.title) ?? `Atendimento — ${who}`,
        notes: str(args.notes) ?? null,
        startsAt,
        durationMinutes: cfg.durationMinutes,
        source: "agent",
        timezone: cfg.timezone,
      });

      const when = formatInZone(startsAt, cfg.timezone);
      return `Agendado para ${when}${cfg.location ? ` (${cfg.location})` : ""}. Confirme esse horário com o contato.`;
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
