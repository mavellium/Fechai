import { prisma } from "../../src/lib/prisma";
import {
  CLINICORP_UNNAMED_PATIENT,
  listClinicorpAgenda,
  type ClinicorpAgendaItem,
} from "../../src/modules/scheduling/clinicorp";
import { renderReminder, type ScheduleConfig } from "../../src/modules/scheduling/config";
import { metaReminderParameters } from "../../src/modules/scheduling/meta-reminder";
import { dateInZone, dayKeyInZone, timeInZone } from "../../src/modules/scheduling/time";
import { getBroadcastConnection } from "../../src/modules/broadcasts/connection";
import { broadcastPhoneVariants, normalizeBroadcastPhone } from "../../src/modules/broadcasts/phone";
import { renderBroadcast } from "../../src/modules/broadcasts/template";
import { getOrCreateConversation } from "../../src/modules/agent-engine/conversation";
import { parseConversationVariables } from "../../src/modules/agent-engine/variables";
import { isPhoneBlocked } from "../../src/modules/whatsapp/blocklist";
import {
  getWhatsAppProviderForInstance,
  WHATSAPP_PROVIDER_SELECT,
} from "../../src/modules/whatsapp/meta-config";
import { dueReminders, loadAccountScheduleConfigs } from "./reminders";

/**
 * Lembretes das consultas marcadas **direto no Clinicorp** — as que aparecem na
 * `/agenda` sem serem um `Appointment` nosso (`listClinicorpAgenda`).
 *
 * Mesmas regras de tempo dos lembretes do fechai (`dueReminders`: antecedência,
 * horário fixo, só o mais próximo quando vários venceram juntos, nada depois do
 * início), com a lista de lembretes da conta. O que muda é **por onde sai**:
 *
 * - **Meta (API oficial)**: sempre com o template aprovado escolhido em
 *   Agentes › Agendar horário (`metaReminderTemplate`). O paciente do
 *   Clinicorp quase sempre nunca falou com o número, e fora da janela de 24h a
 *   Meta só aceita template. Sem template escolhido, a conta não envia.
 * - **Evolution**: só para quem **já conversou** com o número
 *   (`lastInboundAt`), com o texto do lembrete. Primeiro contato pelo Evolution
 *   é o que mais leva o WhatsApp a bloquear o número da clínica — e o bloqueio
 *   cala o atendimento de todos os pacientes. Esse disparo fica pendente, não é
 *   fechado: se a pessoa escrever antes da consulta, o lembrete ainda sai.
 *
 * O que já saiu fica em `ClinicorpReminder` (por id do Clinicorp). O que o
 * próprio fechai espelhou lá (`Appointment.clinicorpAppointmentId`) é pulado:
 * quem lembra essa consulta é `scanAndSendReminders`.
 */

/** Guardar o que saiu por mais tempo que isso só enche a tabela. */
const KEEP_SENT_DAYS = 90;

/**
 * O telefone do Clinicorp no formato do WhatsApp, ou null.
 *
 * O Clinicorp é brasileiro e guarda o número como a recepção digitou:
 * "14991406457", "+55 14 98187-2315", "(14) 9…". Dez ou onze dígitos são DDD +
 * número, e ganham o 55 — é a única suposição, e só vale porque o sistema é de
 * clínicas no Brasil. O resto passa pela mesma validação dos Disparos.
 */
export function clinicorpWhatsappPhone(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "").replace(/^0+/, "");
  return normalizeBroadcastPhone(digits.length === 10 || digits.length === 11 ? `55${digits}` : digits);
}

type Channel =
  | { kind: "meta"; connection: NonNullable<Awaited<ReturnType<typeof getBroadcastConnection>>>; template: NonNullable<ScheduleConfig["metaReminderTemplate"]> }
  | { kind: "evolution"; externalId: string; provider: ReturnType<typeof getWhatsAppProviderForInstance> };

/** Por onde esta conta pode lembrar, ou null se não pode (desconectada, Meta sem template). */
async function channelFor(tenantId: string, cfg: ScheduleConfig): Promise<Channel | null> {
  const instance = await prisma.whatsappInstance.findUnique({
    where: { tenantId },
    select: { status: true, ...WHATSAPP_PROVIDER_SELECT },
  });
  if (!instance?.externalId || instance.status !== "connected") return null;
  if (instance.provider === "meta") {
    if (!cfg.metaReminderTemplate) return null;
    const connection = await getBroadcastConnection(tenantId);
    return connection ? { kind: "meta", connection, template: cfg.metaReminderTemplate } : null;
  }
  const provider = getWhatsAppProviderForInstance(instance);
  return provider.isConfigured() ? { kind: "evolution", externalId: instance.externalId, provider } : null;
}

export async function scanAndSendClinicorpReminders(now: Date = new Date()) {
  const result = { tenants: 0, scanned: 0, sent: 0, firstContactSkipped: 0 };
  const configs = await loadAccountScheduleConfigs();

  await prisma.clinicorpReminder.deleteMany({
    where: { startsAt: { lt: new Date(now.getTime() - KEEP_SENT_DAYS * 24 * 60 * 60_000) } },
  });

  for (const [tenantId, cfg] of configs) {
    if (!cfg.reminderEnabled || cfg.reminders.length === 0) continue;
    try {
      const channel = await channelFor(tenantId, cfg);
      if (!channel) continue;
      const counts = await remindTenant(tenantId, cfg, channel, now);
      result.tenants++;
      result.scanned += counts.scanned;
      result.sent += counts.sent;
      result.firstContactSkipped += counts.firstContactSkipped;
    } catch (err) {
      // Uma conta com problema não pode calar os lembretes das outras.
      console.error("[lembrete clinicorp] conta falhou", tenantId, err);
    }
  }
  return result;
}

async function remindTenant(tenantId: string, cfg: ScheduleConfig, channel: Channel, now: Date) {
  const counts = { scanned: 0, sent: 0, firstContactSkipped: 0 };

  // Do dia de hoje até o último dia em que algum lembrete pode vencer agora —
  // mesmo teto de `scanAndSendReminders`, com um dia a mais para o horário fixo.
  const maxLead = Math.max(...cfg.reminders.map((r) => r.minutesBefore + (r.sendTime ? 1440 : 0)));
  const agenda = await listClinicorpAgenda(
    tenantId,
    dayKeyInZone(now, cfg.timezone),
    dayKeyInZone(new Date(now.getTime() + (maxLead + 1440) * 60_000), cfg.timezone),
    cfg.timezone,
    { fresh: true },
  );
  // Clinicorp fora ou desligado: sem a agenda de agora, nada sai.
  if (agenda.status !== "ok") return counts;
  const upcoming = agenda.items.filter((item) => item.startsAt > now);
  counts.scanned = upcoming.length;
  if (upcoming.length === 0) return counts;

  const ids = upcoming.map((item) => item.id);
  const [mirrored, rows] = await Promise.all([
    prisma.appointment.findMany({
      where: { tenantId, clinicorpAppointmentId: { in: ids } },
      select: { clinicorpAppointmentId: true },
    }),
    prisma.clinicorpReminder.findMany({ where: { tenantId, clinicorpAppointmentId: { in: ids } } }),
  ]);
  const ours = new Set(mirrored.map((m) => m.clinicorpAppointmentId));
  const sentById = new Map(rows.map((row) => [row.clinicorpAppointmentId, row]));

  for (const item of upcoming) {
    if (ours.has(item.id)) continue;

    // Remarcada no Clinicorp (mesmo id, outro horário): os disparos da data
    // antiga não valem para a nova.
    const row = sentById.get(item.id);
    const moved = Boolean(row && row.startsAt.getTime() !== item.startsAt.getTime());
    const already = row && !moved ? row.remindersSent : [];

    const due = dueReminders({ status: "scheduled", startsAt: item.startsAt, remindersSent: already }, cfg.reminders, now, cfg.timezone);
    if (due.length === 0) continue;
    // Vários vencidos juntos: só o mais próximo da consulta, os outros fecham.
    const [toSend] = [...due].sort((a, b) => a.minutesBefore - b.minutesBefore);
    const close = (sentAt: Date | null) =>
      markSent(tenantId, item, already, due.map((r) => r.minutesBefore), sentAt, moved);

    const phone = clinicorpWhatsappPhone(item.phone);
    if (!phone || (await isPhoneBlocked(tenantId, phone))) {
      await close(null);
      continue;
    }

    const known = await prisma.lead.findFirst({
      where: { tenantId, isTest: false, phone: { in: broadcastPhoneVariants(phone) } },
      select: {
        phone: true,
        conversation: { select: { id: true, lastInboundAt: true, followUpReason: true, variables: true } },
      },
    });
    // Pediu para parar: vale para o lembrete como vale para Disparos.
    if (known?.conversation?.followUpReason === "stop") {
      await close(null);
      continue;
    }

    const name = item.patientName === CLINICORP_UNNAMED_PATIENT ? "" : item.patientName;
    const values = {
      nome: name,
      data: dateInZone(item.startsAt, cfg.timezone),
      hora: timeInZone(item.startsAt, cfg.timezone),
      local: cfg.location,
    };

    if (channel.kind === "evolution") {
      const conversation = known?.conversation;
      if (!known || !conversation?.lastInboundAt) {
        counts.firstContactSkipped++;
        continue;
      }
      const text = renderReminder(toSend.template, {
        ...values,
        extras: parseConversationVariables(conversation.variables),
      });
      if (!text) {
        await close(null);
        continue;
      }
      let keyId: string | null;
      try {
        keyId = await channel.provider.sendMessage(channel.externalId, known.phone, text);
      } catch (err) {
        // Mesma regra dos lembretes do fechai: falha do Evolution não consome
        // o disparo, a próxima varredura tenta de novo.
        console.error("[lembrete clinicorp] falha ao enviar", tenantId, item.id, err);
        continue;
      }
      await prisma.message.create({
        data: { conversationId: conversation.id, role: "assistant", content: text, whatsappMessageId: keyId ?? undefined },
      });
      await close(now);
      counts.sent++;
      continue;
    }

    const parameters = metaReminderParameters(channel.template, values);
    if (!parameters) {
      // Parâmetro em branco (paciente sem nome no Clinicorp) a Meta recusaria.
      await close(null);
      continue;
    }
    let messageId: string;
    try {
      messageId = await channel.connection.provider.sendBroadcastTemplate(phone, channel.template, parameters);
    } catch (err) {
      // Nunca reenviar sozinho: numa falha de rede ou 5xx a Meta pode ter
      // aceitado a mensagem (mesma regra do `unknown` dos Disparos). Fecha sem
      // envio; recusa explícita também, senão tentaria a cada varredura.
      console.error("[lembrete clinicorp] Meta não confirmou o envio", tenantId, item.id, err);
      await close(null);
      continue;
    }
    // A mensagem entra na conversa (criada agora, se preciso): é o que dá
    // contexto ao agente quando o paciente responder "não vou poder".
    try {
      const { conversation } = await getOrCreateConversation(tenantId, known?.phone ?? phone, name || undefined);
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: "assistant",
          content: renderBroadcast(channel.template, parameters),
          whatsappMessageId: messageId,
        },
      });
    } catch (err) {
      console.error("[lembrete clinicorp] enviado, mas não gravado na conversa", tenantId, item.id, err);
    }
    await close(now);
    counts.sent++;
  }
  return counts;
}

/**
 * Fecha os disparos indicados. `reminderSentAt` só quando uma mensagem saiu
 * (a `/agenda` mostra "lembrete enviado" a partir dele); numa consulta
 * remarcada, o envio da data antiga deixa de valer e é limpo.
 */
async function markSent(
  tenantId: string,
  item: ClinicorpAgendaItem,
  already: number[],
  closing: number[],
  sentAt: Date | null,
  moved: boolean,
) {
  const remindersSent = [...new Set([...already, ...closing])];
  await prisma.clinicorpReminder.upsert({
    where: { tenantId_clinicorpAppointmentId: { tenantId, clinicorpAppointmentId: item.id } },
    create: { tenantId, clinicorpAppointmentId: item.id, startsAt: item.startsAt, remindersSent, reminderSentAt: sentAt },
    update: {
      startsAt: item.startsAt,
      remindersSent: { set: remindersSent },
      ...(sentAt ? { reminderSentAt: sentAt } : moved ? { reminderSentAt: null } : {}),
    },
  });
}
