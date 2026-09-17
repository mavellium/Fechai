import { prisma } from "@/lib/prisma";
import type { LlmToolSchema } from "@/modules/ai";
import { isWithinBusinessHours, parseScheduleConfig, resolveDuration, type ScheduleConfig } from "@/modules/scheduling/config";
import {
  createAppointment,
  findOwnAppointment,
  getScheduleConfig,
  hasConflictAnywhere,
  listUpcomingLeadAppointments,
} from "@/modules/scheduling/repository";
import { formatInZone, parseLocalDateTime } from "@/modules/scheduling/time";
import { addLeadToHandoffGroup } from "./handoff";
import { ACTION_BY_KEY, type ActionKey } from "./actions";
import { freeSlotsHint, runSchedulingTool, SCHEDULING_TOOLS, schedulingToolAllowed } from "./scheduling-tools";

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
export function getToolSchemas(activeKeys: string[], scheduleConfig?: ScheduleConfig): LlmToolSchema[] {
  const schemas = activeKeys
    // Desativadas temporariamente não são expostas ao LLM mesmo se o tenant
    // ainda tiver a linha enabled no banco.
    .filter((k) => ACTION_BY_KEY[k as ActionKey]?.status !== "disabled")
    .map((k) => TOOLS[k as ActionKey]?.schema)
    .filter((s): s is LlmToolSchema => Boolean(s));
  if (activeKeys.includes("schedule_meeting")) {
    const cfg = scheduleConfig ?? parseScheduleConfig(null);
    schemas.push(...SCHEDULING_TOOLS.filter((tool) => schedulingToolAllowed(tool.name, cfg)));
  }
  return schemas;
}

export async function runToolHandler(
  key: string,
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<string> {
  if (SCHEDULING_TOOLS.some((tool) => tool.name === key)) {
    try {
      const action = ctx.agentId ? await prisma.tenantAction.findFirst({
        where: { tenantId: ctx.tenantId, agentId: ctx.agentId, key: "schedule_meeting", enabled: true },
        select: { config: true },
      }) : null;
      if (!action) return "Agendamento desabilitado para este agente.";
      return await runSchedulingTool(key, ctx, args, parseScheduleConfig(action.config));
    } catch (err) {
      console.error(`[tools] falha em ${key}`, err);
      return `Falha ao executar ${key}. Consulte a agenda antes de afirmar que houve alteração.`;
    }
  }
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
          tipoAtendimento: { type: "string", description: "Nome EXATO do tipo de atendimento, copiado da lista de tipos com duração própria do contexto. Define o tamanho do bloco. Omita quando o negócio não tiver tipos ou quando o contato não disse qual quer." },
          additionalAppointment: { type: "boolean", description: "True somente se o contato pediu explicitamente OUTRA consulta separada, mantendo a anterior. Nunca use para reagendamento." },
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

      // A variação escolhida muda o tamanho do bloco, então entra ANTES da
      // checagem de expediente e de conflito: uma limpeza de 30 min cabe às
      // 17:30 num expediente que fecha às 18:00, uma avaliação de 60 não.
      const duration = resolveDuration(cfg, str(args.tipoAtendimento));

      if (!isWithinBusinessHours(startsAt, { ...cfg, durationMinutes: duration.minutes })) {
        return `Fora do expediente (${cfg.startTime} às ${cfg.endTime}) ou durante uma pausa, considerando um bloco de ${duration.minutes} min. Proponha outro horário respeitando os intervalos.`;
      }

      const endsAt = new Date(startsAt.getTime() + duration.minutes * 60_000);

      // O LLM pode chamar de novo pra "confirmar" um horário que ele mesmo já
      // marcou nesta conversa — trata como sucesso (idempotente) em vez de
      // bater no conflito contra o próprio agendamento e entrar em loop.
      const own = await findOwnAppointment(ctx.tenantId, ctx.conversationId, startsAt, endsAt);
      if (own) {
        const when = formatInZone(own.startsAt, cfg.timezone);
        return `Esse horário já está confirmado para ${when}${cfg.location ? ` (${cfg.location})` : ""}. Não é necessário marcar de novo — apenas confirme com o contato.`;
      }

      const upcoming = await listUpcomingLeadAppointments(ctx.tenantId, ctx.leadId);
      if (upcoming.length && args.additionalAppointment !== true) {
        return `O contato já tem consulta marcada: ${upcoming.map((a) => `${a.id}: ${formatInZone(a.startsAt, cfg.timezone)}`).join("; ")}. Não crie outra para confirmar ou reagendar. Para trocar, use reschedule_meeting se habilitado; caso contrário, ofereça atendimento humano. Só marque outra consulta se o contato pedir explicitamente uma consulta adicional, mantendo a anterior.`;
      }

      // Olha a nossa agenda E a do Clinicorp, quando conectado: a recepção
      // marca paciente direto no sistema da clínica e esses horários nunca
      // passaram por aqui.
      if (await hasConflictAnywhere(ctx.tenantId, startsAt, endsAt, cfg.timezone)) {
        return `Esse horário está ocupado; nada foi marcado. Não diga ao contato que está confirmado.${await freeSlotsHint(ctx, cfg, startsAt)}`;
      }

      const lead = await prisma.lead.findUnique({
        where: { id: ctx.leadId },
        select: { name: true, phone: true },
      });
      const who = lead?.name || lead?.phone || "contato";

      const appointment = await createAppointment({
        tenantId: ctx.tenantId,
        agentId: ctx.agentId,
        leadId: ctx.leadId,
        conversationId: ctx.conversationId,
        title: str(args.title) ?? `Atendimento — ${who}`,
        notes: str(args.notes) ?? null,
        startsAt,
        durationMinutes: duration.minutes,
        source: "agent",
        timezone: cfg.timezone,
      });

      const when = formatInZone(startsAt, cfg.timezone);
      // O nome pedido pode não existir na lista: o horário foi marcado com a
      // duração padrão, e o LLM precisa saber disso para não confirmar ao
      // contato um tipo de atendimento que a agenda não registrou.
      const kind = duration.label
        ? ` (${duration.label}, ${duration.minutes} min)`
        : cfg.durations.length && str(args.tipoAtendimento)
          ? `. Atenção: "${str(args.tipoAtendimento)}" não está na lista de tipos, então reservei o bloco padrão de ${duration.minutes} min — confirme com o contato qual tipo ele quer antes de prometer outro`
          : "";
      if (appointment.clinicorpSync.status === "failed") {
        return `Agendado no fechai para ${when}${kind}${cfg.location ? ` (${cfg.location})` : ""}. O envio ao Clinicorp não foi confirmado. O horário continua reservado; não marque novamente nem afirme que já aparece no Clinicorp.`;
      }
      return `Agendado para ${when}${kind}${cfg.location ? ` (${cfg.location})` : ""}. Confirme esse horário com o contato.`;
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

      // `isTest` vem junto do telefone: no sandbox o número é sintético, e
      // adicioná-lo ao grupo real da equipe é efeito colateral de um teste.
      const lead = await prisma.lead.findUnique({
        where: { id: ctx.leadId },
        select: { phone: true, isTest: true },
      });
      if (lead) {
        await addLeadToHandoffGroup(ctx.tenantId, ctx.agentId, lead.phone, {
          isTest: lead.isTest,
        });
      }

      return "Conversa marcada como 'precisa atenção' de um humano.";
    },
  },
};
