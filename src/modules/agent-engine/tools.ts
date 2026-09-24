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
import { DISQUALIFY_REASONS, parseReason } from "./disqualify";
import { addLeadToHandoffGroup, handoffToolDescription, type HandoffConfig } from "./handoff";
import { ACTION_BY_KEY, type ActionKey } from "./actions";
import { freeSlotsHint, runSchedulingTool, SCHEDULING_TOOLS, schedulingToolAllowed } from "./scheduling-tools";
import { allVariableDefinitions, parseVariableDefinitions, rememberConversationVariables, type VariableDefinition } from "./variables";

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
export function getToolSchemas(
  activeKeys: string[],
  scheduleConfig?: ScheduleConfig,
  variableDefinitions?: VariableDefinition[],
  handoffConfig?: HandoffConfig,
): LlmToolSchema[] {
  const schemas = activeKeys
    // Desativadas temporariamente não são expostas ao LLM mesmo se o tenant
    // ainda tiver a linha enabled no banco.
    .filter((k) => ACTION_BY_KEY[k as ActionKey]?.status !== "disabled")
    .map((k) => TOOLS[k as ActionKey]?.schema)
    .filter((s): s is LlmToolSchema => Boolean(s))
    .map((s) =>
      s.name === "handoff_human" ? { ...s, description: handoffToolDescription(handoffConfig) } : s,
    );
  if (activeKeys.includes("schedule_meeting")) {
    const cfg = scheduleConfig ?? parseScheduleConfig(null);
    schemas.push(...SCHEDULING_TOOLS.filter((tool) => schedulingToolAllowed(tool.name, cfg)));
  }
  if (variableDefinitions) {
    schemas.push({
      name: "remember_variables",
      description: "Guarda ou corrige dados que o contato informou nesta conversa. Use assim que um valor for dito. Não invente valores nem envie campos vazios.",
      parameters: {
        type: "object",
        properties: {
          values: {
            type: "object",
            description: "Somente variáveis cujo valor foi informado pelo contato.",
            properties: Object.fromEntries(allVariableDefinitions(variableDefinitions).filter((row) => row.key !== "numero").map((row) => [row.key, {
              type: "string", description: row.description,
            }])),
          },
        },
        required: ["values"],
      },
    });
  }
  return schemas;
}

export async function runToolHandler(
  key: string,
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<string> {
  if (key === "remember_variables") {
    try {
      if (!ctx.agentId) return "Agente não encontrado.";
      const agent = await prisma.agent.findFirst({
        where: { id: ctx.agentId, tenantId: ctx.tenantId },
        select: { variableDefinitions: true },
      });
      if (!agent) return "Agente não encontrado.";
      return await rememberConversationVariables({
        tenantId: ctx.tenantId,
        conversationId: ctx.conversationId,
        definitions: parseVariableDefinitions(agent.variableDefinitions),
        values: args.values,
      });
    } catch (err) {
      console.error("[tools] falha ao guardar variáveis", err);
      return "Não foi possível guardar os dados desta conversa agora. Não afirme que foram salvos.";
    }
  }
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
          patientName: { type: "string", description: "Nome da pessoa que será atendida. Se o contato marcar para outra pessoa, use o nome dessa pessoa, não o nome do contato. Pergunte se ainda não souber." },
          notes: { type: "string", description: "Observações clínicas ou logísticas combinadas na conversa. Não use para guardar o nome do paciente." },
          tipoAtendimento: { type: "string", description: "Nome EXATO do tipo de atendimento, copiado da lista de tipos com duração própria do contexto. Define o tamanho do bloco. Omita quando o negócio não tiver tipos ou quando o contato não disse qual quer." },
          additionalAppointment: { type: "boolean", description: "True somente se o contato pediu explicitamente OUTRA consulta separada, mantendo a anterior. Nunca use para reagendamento." },
        },
        required: ["date", "time", "patientName"],
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
      const patientName = str(args.patientName);
      if (!patientName) return "Falta o nome da pessoa que será atendida. Pergunte ao contato antes de marcar; não use o nome do contato sem confirmar que é o paciente.";

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
        return `Fora dos períodos de atendimento deste dia ou durante uma pausa, considerando um bloco de ${duration.minutes} min. Consulte list_available_slots e proponha outro horário respeitando os intervalos.`;
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

      const appointment = await createAppointment({
        tenantId: ctx.tenantId,
        agentId: ctx.agentId,
        leadId: ctx.leadId,
        conversationId: ctx.conversationId,
        title: patientName,
        patientName,
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

  // Quem some é reengajado pelo worker sozinho (esteira "sem resposta"); a tool
  // existe para o que só a conversa revela: o contato disse que NÃO quer
  // agendar agora, ou que não quer mais mensagens. Ver modules/follow-up/config.ts.
  follow_up: {
    schema: {
      name: "follow_up",
      description:
        "Registra como o contato deixou a conversa, para o follow-up automático usar a abordagem certa. " +
        "Use motivo 'nao_quer_agendar' quando ele disser que não quer marcar agora (vai pensar, está sem tempo, achou caro, vai ver depois): o follow-up passa a ser espaçado e sem pressão. " +
        "Use motivo 'pediu_para_parar' quando ele disser que não tem interesse ou pedir para não receber mais mensagens: nenhum follow-up será enviado. " +
        "Não use quando o contato só demorou para responder — o sistema já reengaja sozinho quem some. Nunca use depois de schedule_meeting confirmar um horário.",
      parameters: {
        type: "object",
        properties: {
          motivo: {
            type: "string",
            enum: ["nao_quer_agendar", "pediu_para_parar"],
            description: "Por que o contato não vai agendar agora.",
          },
        },
        required: ["motivo"],
      },
    },
    handler: async (ctx, args) => {
      const reason = args.motivo === "nao_quer_agendar" ? "declined" : args.motivo === "pediu_para_parar" ? "stop" : null;
      if (!reason) return "Informe o motivo: nao_quer_agendar ou pediu_para_parar.";
      // "Pare de me mandar mensagem" vale mesmo com consulta marcada; já a
      // esteira de quem recusou não faz sentido para quem tem horário.
      if (reason === "declined") {
        const upcoming = await listUpcomingLeadAppointments(ctx.tenantId, ctx.leadId);
        if (upcoming.length) {
          return "Follow-up automático não programado: o contato já tem uma consulta futura marcada. Não envie reengajamento; use apenas os lembretes configurados para a consulta.";
        }
      }
      await prisma.conversation.updateMany({
        where: { id: ctx.conversationId, tenantId: ctx.tenantId },
        data: { followUpReason: reason },
      });
      return reason === "stop"
        ? "Registrado: este contato não receberá follow-up automático. Responda com educação, sem insistir."
        : "Registrado: o follow-up deste contato será espaçado e sem pressão. Responda com leveza, sem insistir agora.";
    },
  },

  handoff_human: {
    schema: {
      name: "handoff_human",
      description: handoffToolDescription(),
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

  disqualify_lead: {
    schema: {
      name: "disqualify_lead",
      description:
        "Marca o contato como fora do perfil de cliente quando ficou claro que ele não procura atendimento (vendedor, parceria, currículo, trote, engano) ou está fora da área atendida. Não use para quem procura atendimento mas está indeciso, achou caro ou quer pensar — esses continuam sendo clientes em potencial.",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            enum: DISQUALIFY_REASONS.map((r) => r.key),
            description: DISQUALIFY_REASONS.map((r) => `${r.key}: ${r.hint}`).join(" | "),
          },
        },
        required: ["reason"],
      },
    },
    handler: async (ctx, args) => {
      const reason = parseReason(args.reason);

      // `updateMany` com o tenant no filtro: o id do lead vem do contexto do
      // turno, mas escrever por id cru numa tool é o tipo de caminho em que um
      // id trocado atravessa tenant sem ninguém perceber.
      //
      // `disqualifiedAt: null` no filtro mantém o PRIMEIRO carimbo: se o
      // contato voltar e o agente desqualificar de novo, a data original é a
      // que conta — senão o mesmo contato entraria no relatório de dois meses.
      await prisma.lead.updateMany({
        where: { id: ctx.leadId, tenantId: ctx.tenantId, disqualifiedAt: null },
        data: { disqualifiedAt: new Date(), disqualifiedReason: reason },
      });

      // A conversa NÃO é marcada como `needsHuman` — o ponto da triagem é
      // exatamente não ocupar uma pessoa. Também não encerramos a conversa: se
      // o contato responder de novo, o agente segue atendendo normalmente.
      return "Contato registrado como fora do perfil. Encerre a conversa com educação, sem prometer retorno.";
    },
  },
};
