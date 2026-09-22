import { Prisma } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import {
  getWhatsAppProviderForInstance,
  WHATSAPP_PROVIDER_SELECT,
} from "../../src/modules/whatsapp/meta-config";
import {
  parseScheduleConfig,
  renderReminder,
  type ReminderRule,
  type ScheduleConfig,
} from "../../src/modules/scheduling/config";
import { parseReminderOverride } from "../../src/modules/scheduling/reminder-override";
import { parseConversationVariables } from "../../src/modules/agent-engine/variables";
import { dateInZone, partsInZone, timeInZone, zonedTimeToUtc } from "../../src/modules/scheduling/time";

/**
 * Lembretes pré-consulta. Rodam no mesmo worker do follow-up (mesma varredura
 * periódica), mas é outra regra: o follow-up reage ao silêncio do lead, estes
 * reagem ao relógio da agenda.
 *
 * Uma consulta pode ter vários lembretes ("1 semana antes", "1 dia antes",
 * "2 horas antes"), e cada disparo é marcado sozinho em
 * `Appointment.remindersSent` — um booleano só calaria todos depois do
 * primeiro.
 */

type ReminderCandidate = {
  status: string;
  startsAt: Date;
  remindersSent: number[];
};

/** Instante de disparo no fuso da agenda; sem horário fixo, duração exata. */
export function reminderDueAt(startsAt: Date, rule: ReminderRule, timezone: string): Date {
  if (!rule.sendTime) return new Date(startsAt.getTime() - rule.minutesBefore * 60_000);
  const local = partsInZone(startsAt, timezone);
  const day = new Date(Date.UTC(local.year, local.month - 1, local.day - rule.minutesBefore / 1440));
  const [hour, minute] = rule.sendTime.split(":").map(Number);
  return zonedTimeToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hour, minute, timezone);
}

/**
 * Quais disparos estão vencidos agora, do mais distante para o mais próximo.
 *
 * A janela começa em `reminderDueAt` (antecedência exata ou horário local fixo)
 * e termina em `startsAt`. O limite de cima importa: um worker parado por duas horas não pode acordar e
 * mandar "sua consulta é amanhã" para quem já foi atendido. Quem ficou para
 * trás é marcado como enviado sem enviar (ver `scanAndSendReminders`), senão
 * a mesma consulta seria reavaliada em todo ciclo para sempre.
 */
export function dueReminders(
  appt: ReminderCandidate,
  reminders: ReminderRule[],
  now: Date,
  timezone = "America/Sao_Paulo",
): ReminderRule[] {
  if (appt.status !== "scheduled") return [];
  if (appt.startsAt.getTime() < now.getTime()) return [];
  const sent = new Set(appt.remindersSent);
  return reminders
    .filter((r) => !sent.has(r.minutesBefore))
    .filter((r) => now.getTime() >= reminderDueAt(appt.startsAt, r, timezone).getTime())
    .sort((a, b) => b.minutesBefore - a.minutesBefore);
}

/**
 * Disparos que perderam a janela: a consulta já passou, ou o horário deles
 * ficou para trás enquanto o worker estava fora. São fechados sem enviar.
 *
 * Por que fechar em vez de ignorar: `remindersSent` é o que impede reavaliar
 * a mesma consulta para sempre. E por que não enviar: "sua consulta é amanhã"
 * chegando depois da consulta é pior do que lembrete nenhum.
 */
export function staleReminders(
  appt: ReminderCandidate,
  reminders: ReminderRule[],
  now: Date,
): ReminderRule[] {
  const sent = new Set(appt.remindersSent);
  const pending = reminders.filter((r) => !sent.has(r.minutesBefore));
  if (appt.status !== "scheduled" || appt.startsAt.getTime() < now.getTime()) return pending;
  return [];
}

/** Os lembretes que valem para esta consulta: os dela, ou os do agente. */
export function remindersFor(
  appt: { reminderOverride: unknown },
  cfg: Pick<ScheduleConfig, "reminderEnabled" | "reminders">,
): ReminderRule[] {
  const override = parseReminderOverride(appt.reminderOverride);
  // Lista vazia no override é uma escolha ("esta consulta não recebe
  // lembrete"), diferente de não ter override. Por isso `!== null`, e não
  // um `||` que trataria vazio como ausente.
  if (override !== null) return override;
  return cfg.reminderEnabled ? cfg.reminders : [];
}

export async function scanAndSendReminders(now: Date = new Date()) {
  // A configuração dos lembretes mora na ação `schedule_meeting` (não numa
  // ação própria), e só age com a ação LIGADA — mesma regra de
  // `getActiveHandoffConfig`: config salva com a ação desligada não atua.
  const enabled = await prisma.tenantAction.findMany({
    where: { key: "schedule_meeting", enabled: true },
    select: { agentId: true, config: true },
  });
  if (enabled.length === 0) return { scanned: 0, sent: 0 };

  const configByAgent = new Map<string, ScheduleConfig>(
    enabled.map((a) => [a.agentId, parseScheduleConfig(a.config)]),
  );

  // Teto da busca: a maior antecedência configurada. Sem ele, a varredura
  // carregaria a agenda inteira do ano para descartar quase tudo em memória.
  // Uma consulta pode ter override próprio mais distante que o do agente, por
  // isso o teto considera os dois.
  const configuredRules = [...configByAgent.values()]
    .filter((cfg) => cfg.reminderEnabled)
    .flatMap((cfg) => cfg.reminders);
  // Um horário fixo na véspera pode cair quase um dia antes do instante
  // "24 horas antes"; inclua essa margem na busca sem carregar o ano inteiro.
  const maxLeadMinutes = Math.max(0, ...configuredRules.map((r) =>
    r.minutesBefore + (r.sendTime ? 1440 : 0),
  ));

  const appointments = await prisma.appointment.findMany({
    where: {
      agentId: { in: [...configByAgent.keys()] },
      status: "scheduled",
      startsAt: { gte: now },
      // Conversa de teste não recebe lembrete: o sandbox usa telefone
      // sintético, mesma regra do follow-up e do grupo de handoff.
      lead: { isTest: false },
      OR: [
        { startsAt: { lte: new Date(now.getTime() + maxLeadMinutes * 60_000) } },
        // Consulta com lembretes próprios: a antecedência dela pode ser maior
        // que qualquer uma do agente, então não cabe no teto acima.
        { reminderOverride: { not: Prisma.DbNull } },
      ],
    },
    include: { lead: true, conversation: { select: { variables: true } } },
  });

  // Consultas que já passaram e ainda tinham disparo pendente: fechar sem
  // enviar nada. É o caso do worker que ficou fora do ar — a janela passou
  // junto com a consulta, e avisar agora seria pior do que não avisar.
  // Fechar (em vez de ignorar) é o que impede reavaliá-las em todo ciclo.
  const overdue = await prisma.appointment.findMany({
    where: {
      agentId: { in: [...configByAgent.keys()] },
      status: "scheduled",
      startsAt: { lt: now },
    },
    select: { id: true, agentId: true, remindersSent: true, reminderOverride: true, startsAt: true, status: true },
  });
  for (const appt of overdue) {
    const cfg = appt.agentId ? configByAgent.get(appt.agentId) : undefined;
    if (!cfg) continue;
    const pending = staleReminders(appt, remindersFor(appt, cfg), now);
    if (pending.length === 0) continue;
    await markSent(appt.id, appt.remindersSent, pending.map((r) => r.minutesBefore), null);
  }

  let sent = 0;

  for (const appt of appointments) {
    const cfg = appt.agentId ? configByAgent.get(appt.agentId) : undefined;
    if (!cfg) continue;

    const rules = remindersFor(appt, cfg);
    if (rules.length === 0) continue;

    const due = dueReminders(appt, rules, now, cfg.timezone);
    if (due.length === 0) continue;

    // Vários disparos vencidos de uma vez (worker parado, ou dois lembretes
    // muito próximos): manda só o MAIS PRÓXIMO da consulta e fecha os outros.
    // Três mensagens seguidas dizendo "é daqui a uma semana / é amanhã / é em
    // duas horas" chegariam juntas, todas desatualizadas menos a última.
    const [toSend] = [...due].sort((a, b) => a.minutesBefore - b.minutesBefore);
    const closing = due.map((r) => r.minutesBefore);

    if (!appt.lead?.phone) {
      await markSent(appt.id, appt.remindersSent, closing, null);
      continue;
    }

    const text = renderReminder(toSend.template, {
      // Contato sem nome cadastrado existe (o WhatsApp nem sempre entrega um):
      // `renderReminder` limpa o espaço e a pontuação que sobram.
      nome: appt.lead.name?.trim() ?? "",
      data: dateInZone(appt.startsAt, cfg.timezone),
      hora: timeInZone(appt.startsAt, cfg.timezone),
      local: cfg.location,
      extras: parseConversationVariables(appt.conversation?.variables),
    });
    if (!text) {
      await markSent(appt.id, appt.remindersSent, closing, null);
      continue;
    }

    let keyId: string | null = null;
    {
      const instance = await prisma.whatsappInstance.findUnique({
        where: { tenantId: appt.tenantId },
        select: { status: true, ...WHATSAPP_PROVIDER_SELECT },
      });
      if (instance?.externalId && instance.status === "connected") {
        try {
          const provider = getWhatsAppProviderForInstance(instance);
          if (provider.isConfigured()) {
            keyId = await provider.sendMessage(instance.externalId, appt.lead.phone, text);
          }
        } catch (err) {
          console.error("[lembrete] falha ao enviar", appt.id, err);
        }
      }
    }

    // A mensagem entra na conversa como fala do agente. É isso que faz a
    // resposta do paciente ("não vou poder") cair no `runAgentTurn` normal,
    // com o contexto da consulta vindo de `recognizeExisting` — cancelar e
    // reagendar já existem, o lembrete só precisa abrir a porta.
    if (appt.conversationId) {
      await prisma.message.create({
        data: {
          conversationId: appt.conversationId,
          role: "assistant",
          content: text,
          whatsappMessageId: keyId ?? undefined,
        },
      });
    }
    await markSent(appt.id, appt.remindersSent, closing, now);
    sent++;
  }

  return { scanned: appointments.length, sent };
}

/**
 * Fecha os disparos indicados, preservando os que já estavam marcados.
 *
 * `sentAt` só é gravado quando uma mensagem de fato saiu: a tela mostra
 * "lembrete enviado há X" a partir dele, e um disparo fechado sem envio
 * (consulta já passada, contato sem telefone) faria essa frase mentir.
 */
async function markSent(
  id: string,
  already: number[],
  closing: number[],
  sentAt: Date | null,
) {
  await prisma.appointment.update({
    where: { id },
    data: {
      remindersSent: { set: [...new Set([...already, ...closing])] },
      ...(sentAt ? { reminderSentAt: sentAt } : {}),
    },
  });
}
