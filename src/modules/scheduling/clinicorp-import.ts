import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getOrCreateConversation } from "@/modules/agent-engine/conversation";
import { broadcastPhoneVariants } from "@/modules/broadcasts/phone";
import { canonicalPhone } from "@/modules/whatsapp/blocklist";
import { listClinicorpAgenda, recordClinicorpImport, type ClinicorpAgendaItem } from "./clinicorp";
import { MAX_REMINDER_MINUTES, parseScheduleConfig, reminderDueAt, type ReminderRule } from "./config";
import { deleteEventFromGoogle } from "./google";
import { parseReminderOverride } from "./reminder-override";
import { IMPORTED_SOURCE, NOT_IMPORTED } from "./source";
import { dayKeyInZone, parseLocalDateTime } from "./time";

/**
 * Traz para a agenda daqui o que a recepção marca direto no Clinicorp, para o
 * agente mandar lembrete também dessas consultas.
 *
 * A API do Clinicorp não tem webhook: a importação é uma varredura periódica
 * no worker (`workers/follow-up-worker`), que lê a agenda da clínica de hoje
 * até onde o lembrete mais distante alcança e reconcilia com a daqui.
 *
 * Quem vence em divergência depende de quem criou a consulta:
 *
 * - **Importada** (`source: "clinicorp"`): o Clinicorp. Horário, nome e
 *   telefone seguem o de lá; desmarcada/excluída lá sai daqui; sumida do
 *   período (movida para longe, trocou de profissional) também, depois de uma
 *   hora sem aparecer.
 * - **Criada pelo fechai** e espelhada: o horário continua sendo o daqui. Só a
 *   exclusão EXPLÍCITA lá vale — a consulta não existe mais na clínica, e
 *   lembrar dela seria mandar o paciente para uma cadeira vazia.
 *
 * Nunca lança por causa do Clinicorp: falha vira `lastImportError` no card e a
 * próxima varredura tenta de novo.
 */

/**
 * Até onde a importação olha: o lembrete mais distante que a tela aceita
 * (8 semanas) mais a véspera de um horário fixo. Além disso nenhum lembrete
 * venceria, e trazer mais seria só carga na API da clínica.
 */
export const IMPORT_HORIZON_DAYS = Math.ceil(MAX_REMINDER_MINUTES / 1440) + 1;

/**
 * Uma importada que a varredura não confirma ativa no Clinicorp há mais do que
 * isto não recebe lembrete (pode ter sido desmarcada lá enquanto a API estava
 * fora) e, se sumiu da lista de lá, sai daqui. Uma hora são várias varreduras:
 * um soluço da API não derruba nada.
 */
export const IMPORT_FRESH_MINUTES = 60;

/**
 * A consulta chega aqui com o atraso de uma varredura e, ao ligar a importação,
 * chega a agenda inteira de uma vez. O lembrete que já tinha vencido antes
 * disso é fechado sem envio — senão "falta uma semana" chegaria para a consulta
 * de depois de amanhã, e "é amanhã" para a de hoje à tarde. A tolerância deixa
 * sair o que venceu durante o atraso normal da varredura.
 */
export const IMPORT_LATE_REMINDER_MINUTES = 30;

/**
 * Linha do fechai alterada há menos disto pode estar no meio de uma operação
 * (envio ao Clinicorp, reagendamento que cancela lá antes de gravar o id novo):
 * a importação não mexe nela nesta volta.
 */
const IN_FLIGHT_MS = 15 * 60_000;

/**
 * Celular do Clinicorp no formato do WhatsApp: "(47) 98870-0805" ->
 * "5547988700805". O cadastro de lá costuma vir sem o 55; número que não fecha
 * como telefone brasileiro volta null (o lembrete não tem para onde ir).
 */
export function clinicorpPhoneToWhatsApp(raw: string | null): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "").replace(/^0+/, "");
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  return /^55[1-9]\d(?:[2-9]\d{7}|9\d{8})$/.test(digits) ? digits : null;
}

/** "2026-09-30" + 2 -> "2026-10-02". Aritmética de calendário, sem fuso. */
function shiftDay(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Fuso e lembretes da conta: os do agente principal (o que atende o WhatsApp),
 * a mesma fonte da `/agenda` e do worker de lembretes. O fuso vale mesmo com
 * a ação desligada — é nele que o Clinicorp escreve os horários da clínica.
 */
async function accountSchedule(tenantId: string): Promise<{ timezone: string; reminders: ReminderRule[] }> {
  const agent = await prisma.agent.findFirst({
    where: { tenantId, archived: false },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    select: { actions: { where: { key: "schedule_meeting" }, select: { enabled: true, config: true } } },
  });
  const action = agent?.actions[0];
  const cfg = parseScheduleConfig(action?.config);
  return { timezone: cfg.timezone, reminders: action?.enabled && cfg.reminderEnabled ? cfg.reminders : [] };
}

/** Antecedências cujo disparo já tinha vencido quando a consulta chegou aqui. */
function missedReminders(startsAt: Date, rules: ReminderRule[], timezone: string, now: Date): number[] {
  const cutoff = now.getTime() - IMPORT_LATE_REMINDER_MINUTES * 60_000;
  return rules.filter((r) => reminderDueAt(startsAt, r, timezone).getTime() < cutoff).map((r) => r.minutesBefore);
}

type LeadMatch = { id: string; conversationId: string | null };

/**
 * Contatos que já existem para os telefones da agenda, pela forma canônica
 * (sem 55 e sem o nono dígito): o WhatsApp entrega o mesmo celular dos dois
 * jeitos, e o Clinicorp não tem como saber qual.
 */
async function leadsByPhone(tenantId: string, phones: string[]): Promise<Map<string, LeadMatch>> {
  if (!phones.length) return new Map();
  const rows = await prisma.lead.findMany({
    where: { tenantId, isTest: false, phone: { in: [...new Set(phones.flatMap(broadcastPhoneVariants))] } },
    orderBy: { createdAt: "asc" },
    select: { id: true, phone: true, conversation: { select: { id: true } } },
  });
  const byPhone = new Map<string, LeadMatch>();
  for (const row of rows) {
    const key = canonicalPhone(row.phone);
    if (!byPhone.has(key)) byPhone.set(key, { id: row.id, conversationId: row.conversation?.id ?? null });
  }
  return byPhone;
}

const LINKED_SELECT = {
  id: true, source: true, status: true, startsAt: true, endsAt: true, title: true,
  patientName: true, patientPhone: true, leadId: true, googleEventId: true,
  reminderOverride: true, clinicorpSeenAt: true, updatedAt: true,
} as const;

export type ClinicorpImportResult =
  | { status: "skipped" }
  | { status: "failed"; error: string }
  | { status: "ok"; created: number; updated: number; removed: number };

/**
 * Uma varredura da agenda do Clinicorp de uma conta. Ver o comentário do topo
 * para a regra de divergência.
 */
export async function syncClinicorpAppointments(tenantId: string, now = new Date()): Promise<ClinicorpImportResult> {
  const schedule = await accountSchedule(tenantId);
  const tz = schedule.timezone;
  const firstDay = dayKeyInZone(now, tz);
  const lastDay = shiftDay(firstDay, IMPORT_HORIZON_DAYS);
  const windowStart = parseLocalDateTime(firstDay, "00:00", tz);
  const windowEnd = parseLocalDateTime(shiftDay(lastDay, 1), "00:00", tz);
  if (!windowStart || !windowEnd) return { status: "skipped" };

  const agenda = await listClinicorpAgenda(tenantId, firstDay, lastDay, tz);
  if (agenda.status === "inactive") return { status: "skipped" };
  if (agenda.status === "failed") {
    await recordClinicorpImport(tenantId, agenda.error);
    return agenda;
  }

  const ids = agenda.items.map((item) => item.id);
  const phoneOf = new Map(agenda.items.map((item) => [item.id, clinicorpPhoneToWhatsApp(item.mobilePhone)]));
  const [linked, ours, leads] = await Promise.all([
    ids.length
      ? prisma.appointment.findMany({ where: { tenantId, clinicorpAppointmentId: { in: ids } }, select: { ...LINKED_SELECT, clinicorpAppointmentId: true } })
      : Promise.resolve([]),
    // O que o fechai marcou no período: base das duas checagens anti-duplicata.
    prisma.appointment.findMany({
      where: { tenantId, status: "scheduled", ...NOT_IMPORTED, startsAt: { gte: windowStart, lt: windowEnd } },
      select: { startsAt: true, endsAt: true, leadId: true, createdAt: true, clinicorpAppointmentId: true },
    }),
    leadsByPhone(tenantId, [...phoneOf.values()].filter((p): p is string => Boolean(p))),
  ]);
  const linkedById = new Map<string, typeof linked>();
  for (const row of linked) linkedById.set(row.clinicorpAppointmentId!, [...(linkedById.get(row.clinicorpAppointmentId!) ?? []), row]);

  let created = 0;
  let updated = 0;
  let removed = 0;
  const stillThere: string[] = [];

  for (const item of agenda.items) {
    const phone = phoneOf.get(item.id) ?? null;
    const lead = phone ? leads.get(canonicalPhone(phone)) ?? null : null;

    const rows = linkedById.get(item.id);
    if (rows) {
      for (const row of rows) {
        const outcome = row.source === IMPORTED_SOURCE
          ? await reconcileImported(tenantId, row, item, phone, lead, schedule, now)
          : await reconcileOwn(tenantId, row, item, now);
        if (outcome === "seen") stillThere.push(row.id);
        if (outcome === "updated") updated++;
        if (outcome === "removed") removed++;
      }
      continue;
    }

    if (item.removed || !item.startsAt || !item.endsAt) continue;
    const startsAt = item.startsAt.getTime();
    // O envio do fechai ao Clinicorp ainda não gravou o id aqui: é a mesma consulta.
    if (ours.some((o) => o.clinicorpAppointmentId === null && o.startsAt.getTime() === startsAt &&
        o.endsAt.getTime() === item.endsAt!.getTime() && now.getTime() - o.createdAt.getTime() < IN_FLIGHT_MS)) continue;
    // O mesmo contato já tem consulta do fechai neste horário (envio sem
    // confirmação, ou a recepção copiou à mão o que o agente marcou): trazer
    // de novo faria o paciente receber cada lembrete duas vezes.
    if (lead && ours.some((o) => o.leadId === lead.id && o.startsAt.getTime() === startsAt)) continue;

    await prisma.appointment.create({
      data: {
        tenantId,
        source: IMPORTED_SOURCE,
        leadId: lead?.id ?? null,
        conversationId: lead?.conversationId ?? null,
        title: item.patientName ?? "Consulta do Clinicorp",
        patientName: item.patientName,
        patientPhone: phone,
        startsAt: item.startsAt,
        endsAt: item.endsAt,
        clinicorpAppointmentId: item.id,
        clinicorpSeenAt: now,
        remindersSent: missedReminders(item.startsAt, schedule.reminders, tz, now),
      },
    });
    created++;
  }

  if (stillThere.length) {
    await prisma.appointment.updateMany({ where: { tenantId, id: { in: stillThere } }, data: { clinicorpSeenAt: now } });
  }

  // O que sumiu da agenda de lá (movido para depois do período, trocou de
  // profissional ou de clínica). Só com a lista inteira legível — um item sem
  // id pode ser justamente o que parece ter sumido — e só depois de uma hora
  // sem aparecer, para uma resposta incompleta da API não derrubar ninguém.
  if (agenda.complete) {
    const { count } = await prisma.appointment.updateMany({
      where: {
        tenantId,
        source: IMPORTED_SOURCE,
        status: "scheduled",
        startsAt: { gte: windowStart, lt: windowEnd },
        clinicorpSeenAt: { lt: new Date(now.getTime() - IMPORT_FRESH_MINUTES * 60_000) },
        ...(ids.length ? { clinicorpAppointmentId: { notIn: ids } } : {}),
      },
      data: { status: "canceled", clinicorpSeenAt: null },
    });
    removed += count;
  }

  await recordClinicorpImport(tenantId, null);
  return { status: "ok", created, updated, removed };
}

type LinkedRow = {
  id: string; source: string; status: string; startsAt: Date; endsAt: Date; title: string;
  patientName: string | null; patientPhone: string | null; leadId: string | null;
  googleEventId: string | null; reminderOverride: unknown; clinicorpSeenAt: Date | null; updatedAt: Date;
};

type Outcome = "none" | "seen" | "updated" | "removed";

/** Importada: o Clinicorp manda. */
async function reconcileImported(
  tenantId: string,
  row: LinkedRow,
  item: ClinicorpAgendaItem,
  phone: string | null,
  lead: LeadMatch | null,
  schedule: { timezone: string; reminders: ReminderRule[] },
  now: Date,
): Promise<Outcome> {
  if (row.status === "done") return "none";

  if (item.removed) {
    if (row.status !== "scheduled") return "none";
    const { count } = await prisma.appointment.updateMany({
      where: { id: row.id, tenantId, status: "scheduled" },
      data: { status: "canceled", clinicorpSeenAt: null },
    });
    return count ? "removed" : "none";
  }

  // Sem horário legível não dá para confirmar nada: não mexe e não conta como
  // vista (o lembrete dela para até a leitura voltar).
  if (!item.startsAt || !item.endsAt) return "none";

  // Cancelada por uma pessoa aqui (a importação zera `clinicorpSeenAt` quando é
  // ela quem cancela). Se continua ativa lá, o cancelamento no Clinicorp falhou
  // e o aviso já está no card; trazer de volta mandaria lembrete a quem desmarcou.
  if (row.status === "canceled" && row.clinicorpSeenAt !== null) return "none";

  const moved = row.startsAt.getTime() !== item.startsAt.getTime() || row.endsAt.getTime() !== item.endsAt.getTime();
  const data: Prisma.AppointmentUncheckedUpdateManyInput = {};
  if (row.status === "canceled") data.status = "scheduled";
  if (moved) {
    // Horário novo, lembretes novos: os já enviados eram do horário antigo.
    const rules = parseReminderOverride(row.reminderOverride) ?? schedule.reminders;
    Object.assign(data, {
      startsAt: item.startsAt,
      endsAt: item.endsAt,
      remindersSent: { set: missedReminders(item.startsAt, rules, schedule.timezone, now) },
      reminderSentAt: null,
    });
  }
  if (item.patientName && item.patientName !== row.patientName) Object.assign(data, { patientName: item.patientName, title: item.patientName });
  if (phone !== row.patientPhone) data.patientPhone = phone;
  if (!row.leadId && lead) Object.assign(data, { leadId: lead.id, conversationId: lead.conversationId });
  if (!Object.keys(data).length) return "seen";

  const { count } = await prisma.appointment.updateMany({
    where: { id: row.id, tenantId, status: row.status, startsAt: row.startsAt },
    data: { ...data, clinicorpSeenAt: now },
  });
  return count ? "updated" : "none";
}

/**
 * Criada pelo fechai e espelhada lá: o horário é daqui. Seguir o de lá
 * desfaria um reagendamento cujo cancelamento no Clinicorp falhou (o id antigo
 * continua ativo lá de propósito, ver `rescheduleAppointment`). Só a exclusão
 * explícita vale.
 */
async function reconcileOwn(tenantId: string, row: LinkedRow, item: ClinicorpAgendaItem, now: Date): Promise<Outcome> {
  if (!item.removed || row.status !== "scheduled") return "none";
  if (now.getTime() - row.updatedAt.getTime() < IN_FLIGHT_MS) return "none";
  const { count } = await prisma.appointment.updateMany({
    where: { id: row.id, tenantId, status: "scheduled", clinicorpAppointmentId: item.id, updatedAt: row.updatedAt },
    data: { status: "canceled" },
  });
  if (!count) return "none";
  // Mesmo efeito de cancelar aqui, menos o Clinicorp, que já está cancelado.
  if (row.googleEventId) await deleteEventFromGoogle(tenantId, row.googleEventId);
  return "removed";
}

/**
 * Todas as contas com a importação ligada. Uma conta que falha não para as
 * outras.
 */
export async function importClinicorpAppointments(now?: Date) {
  const accounts = await prisma.clinicorpIntegration.findMany({
    where: { importAppointments: true },
    select: { tenantId: true },
  });
  const total = { accounts: accounts.length, created: 0, updated: 0, removed: 0, failed: 0 };
  for (const { tenantId } of accounts) {
    try {
      const result = await syncClinicorpAppointments(tenantId, now ?? new Date());
      if (result.status === "failed") total.failed++;
      if (result.status === "ok") {
        total.created += result.created;
        total.updated += result.updated;
        total.removed += result.removed;
      }
    } catch (err) {
      total.failed++;
      console.error("[clinicorp] importação falhou", tenantId, err);
      await recordClinicorpImport(tenantId, "Erro inesperado ao trazer os agendamentos do Clinicorp. A próxima tentativa é automática.");
    }
  }
  return total;
}

/**
 * O contato de uma consulta importada, criado quando o primeiro lembrete vai
 * sair — não na importação: o paciente da recepção pode nunca ter escrito
 * para o número, e criar antes encheria Contatos e Conversas de quem não
 * conversou. Criado, ele passa a ser um contato como o de um Disparo: é na
 * conversa dele que o lembrete fica, e é por ela que a resposta ("não vou
 * poder") chega ao agente com a consulta no contexto.
 */
export async function contactForImportedAppointment(appt: {
  id: string; tenantId: string; patientPhone: string | null; patientName: string | null;
}): Promise<{ phone: string; name: string | null; conversationId: string } | null> {
  if (!appt.patientPhone) return null;
  const existing = await prisma.lead.findFirst({
    where: { tenantId: appt.tenantId, isTest: false, phone: { in: broadcastPhoneVariants(appt.patientPhone) } },
    orderBy: { createdAt: "asc" },
    select: { phone: true },
  });
  const { lead, conversation } = await getOrCreateConversation(
    appt.tenantId,
    existing?.phone ?? appt.patientPhone,
    appt.patientName ?? undefined,
  );
  await prisma.appointment.updateMany({
    where: { id: appt.id, tenantId: appt.tenantId, leadId: null },
    data: { leadId: lead.id, conversationId: conversation.id },
  });
  return { phone: lead.phone, name: lead.name, conversationId: conversation.id };
}
