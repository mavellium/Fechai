import { prisma } from "@/lib/prisma";
import { parseScheduleConfig, type ScheduleConfig } from "./config";
import { deleteEventFromGoogle, pushEventToGoogle } from "./google";
import {
  cancelAppointmentInClinicorp,
  hasClinicorpConflict,
  pushAppointmentToClinicorp,
} from "./clinicorp";
import { dayKeyInZone, monthRangeUtc } from "./time";

/**
 * Leitura e escrita da agenda. Toda query filtra por tenantId (regra do
 * multi-tenant) e passa por aqui — a tela /agenda, as server actions e a tool
 * `schedule_meeting` compartilham exatamente estas regras.
 */

export type CreateAppointmentInput = {
  tenantId: string;
  agentId?: string | null;
  leadId?: string | null;
  conversationId?: string | null;
  title: string;
  notes?: string | null;
  startsAt: Date;
  durationMinutes: number;
  source: "agent" | "manual";
  timezone: string;
};

/** Config de agendamento do agente (ou o padrão, se a ação nunca foi tocada). */
export async function getScheduleConfig(agentId: string): Promise<ScheduleConfig> {
  const action = await prisma.tenantAction.findUnique({
    where: { agentId_key: { agentId, key: "schedule_meeting" } },
    select: { config: true },
  });
  return parseScheduleConfig(action?.config);
}

export async function saveScheduleConfig(
  tenantId: string,
  agentId: string,
  config: ScheduleConfig,
): Promise<void> {
  await prisma.tenantAction.upsert({
    where: { agentId_key: { agentId, key: "schedule_meeting" } },
    // Salvar horário de atendimento não liga a ação sozinha — quem liga é o
    // toggle. Daí `enabled: false` na criação.
    create: { tenantId, agentId, key: "schedule_meeting", enabled: false, config },
    update: { config },
  });
}

/**
 * Existe algo marcado que encoste neste intervalo?
 *
 * Sobreposição é `início < fimExistente && fim > inícioExistente` — comparar só
 * o início deixaria passar um horário que começa no meio de outro.
 */
export async function hasConflict(
  tenantId: string,
  startsAt: Date,
  endsAt: Date,
  ignoreId?: string,
): Promise<boolean> {
  const clash = await prisma.appointment.findFirst({
    where: {
      tenantId,
      status: "scheduled",
      ...(ignoreId ? { id: { not: ignoreId } } : {}),
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
    },
    select: { id: true },
  });
  return Boolean(clash);
}

/**
 * Como `hasConflict`, mas olhando também a agenda do Clinicorp quando a conta
 * está conectada.
 *
 * Existe separado porque a nossa agenda não é a agenda inteira da clínica: a
 * recepção marca gente direto no sistema deles o dia todo, e o agente não pode
 * oferecer um horário que já tem paciente na cadeira. A consulta local vem
 * primeiro — é a barata, e quando ela já acusa conflito não há motivo para
 * gastar uma chamada de rede.
 */
export async function hasConflictAnywhere(
  tenantId: string,
  startsAt: Date,
  endsAt: Date,
  timezone: string,
  ignoreId?: string,
): Promise<boolean> {
  if (await hasConflict(tenantId, startsAt, endsAt, ignoreId)) return true;
  return hasClinicorpConflict(tenantId, startsAt, endsAt, timezone);
}

/**
 * A própria conversa já tem esse horário marcado?
 *
 * O agente confirma um agendamento chamando `schedule_meeting` de novo mais
 * tarde na mesma conversa (o LLM não tem garantia de lembrar que já marcou —
 * só vê o resultado em texto no histórico). Sem checar isto antes, a segunda
 * chamada batia em `hasConflict` contra o compromisso que ELE MESMO acabara de
 * criar, o agente achava que o horário fora tomado por outra pessoa, oferecia
 * outro, marcava esse, e repetia — nunca fechando o agendamento.
 */
export async function findOwnAppointment(
  conversationId: string,
  startsAt: Date,
  endsAt: Date,
) {
  return prisma.appointment.findFirst({
    where: {
      conversationId,
      status: "scheduled",
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
    },
  });
}

export async function createAppointment(input: CreateAppointmentInput) {
  const endsAt = new Date(input.startsAt.getTime() + input.durationMinutes * 60_000);

  const appointment = await prisma.appointment.create({
    data: {
      tenantId: input.tenantId,
      agentId: input.agentId ?? null,
      leadId: input.leadId ?? null,
      conversationId: input.conversationId ?? null,
      title: input.title,
      notes: input.notes ?? null,
      startsAt: input.startsAt,
      endsAt,
      source: input.source,
    },
  });

  // O lead agendado é o resultado que o produto promete — o status acompanha.
  if (input.leadId) {
    await prisma.lead
      .update({ where: { id: input.leadId }, data: { status: "scheduled" } })
      .catch(() => {});
  }

  // O Clinicorp liga o horário ao cadastro do paciente pelo telefone, então
  // precisa do contato — o Google não usa nada disso.
  const lead = input.leadId
    ? await prisma.lead
        .findUnique({ where: { id: input.leadId }, select: { name: true, phone: true } })
        .catch(() => null)
    : null;

  // Os dois espelhos são independentes e nenhum lança: em paralelo, porque um
  // agendamento feito no meio de uma conversa não pode esperar duas APIs de
  // terceiro em sequência.
  const [googleEventId, clinicorpSync] = await Promise.all([
    pushEventToGoogle(input.tenantId, {
      title: input.title,
      description: input.notes ?? undefined,
      startsAt: input.startsAt,
      endsAt,
      timeZone: input.timezone,
    }),
    pushAppointmentToClinicorp(input.tenantId, {
      title: input.title,
      notes: input.notes,
      startsAt: input.startsAt,
      endsAt,
      timeZone: input.timezone,
      lead,
    }),
  ]);
  const clinicorpAppointmentId = clinicorpSync.status === "synced" ? clinicorpSync.appointmentId : null;

  if (googleEventId || clinicorpAppointmentId) {
    await prisma.appointment.update({
      where: { id: appointment.id },
      data: {
        ...(googleEventId ? { googleEventId } : {}),
        ...(clinicorpAppointmentId ? { clinicorpAppointmentId } : {}),
      },
    });
  }

  return { ...appointment, googleEventId, clinicorpAppointmentId, clinicorpSync };
}

export async function cancelAppointment(tenantId: string, id: string) {
  const appointment = await prisma.appointment.findFirst({ where: { id, tenantId } });
  if (!appointment) return null;

  await prisma.appointment.update({ where: { id }, data: { status: "canceled" } });
  await Promise.all([
    appointment.googleEventId
      ? deleteEventFromGoogle(tenantId, appointment.googleEventId)
      : Promise.resolve(),
    appointment.clinicorpAppointmentId
      ? cancelAppointmentInClinicorp(tenantId, appointment.clinicorpAppointmentId)
      : Promise.resolve(),
  ]);
  return appointment;
}

export async function markAppointmentDone(tenantId: string, id: string) {
  const { count } = await prisma.appointment.updateMany({
    where: { id, tenantId },
    data: { status: "done" },
  });
  return count > 0;
}

const withLead = {
  lead: { select: { id: true, name: true, phone: true, status: true } },
  agent: { select: { id: true, name: true } },
} as const;

/** Compromissos de um mês (do fuso do tenant), já agrupados por dia local. */
export async function listMonthAppointments(
  tenantId: string,
  year: number,
  month: number,
  timezone: string,
) {
  const { start, end } = monthRangeUtc(year, month, timezone);
  const rows = await prisma.appointment.findMany({
    where: { tenantId, startsAt: { gte: start, lt: end } },
    orderBy: { startsAt: "asc" },
    include: withLead,
  });

  const byDay = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = dayKeyInZone(row.startsAt, timezone);
    byDay.set(key, [...(byDay.get(key) ?? []), row]);
  }
  return { rows, byDay };
}

/** Próximos compromissos ainda de pé — usado na home e na lateral da agenda. */
export async function listUpcomingAppointments(tenantId: string, take = 5) {
  return prisma.appointment.findMany({
    where: { tenantId, status: "scheduled", startsAt: { gte: new Date() } },
    orderBy: { startsAt: "asc" },
    take,
    include: withLead,
  });
}

export async function listLeadAppointments(tenantId: string, leadId: string) {
  return prisma.appointment.findMany({
    where: { tenantId, leadId },
    orderBy: { startsAt: "asc" },
  });
}
