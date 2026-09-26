"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireTenant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { payloadTooLarge } from "@/lib/rate-limit";
import {
  cancelAppointment,
  createAppointment,
  getScheduleConfig,
  hasConflictAnywhere,
  markAppointmentDone,
} from "@/modules/scheduling/repository";
import {
  MAX_REMINDER_MINUTES,
  formatReminderLead,
  validateReminders,
  type ReminderRule,
} from "@/modules/scheduling/config";
import { serializeReminderOverride } from "@/modules/scheduling/reminder-override";
import { parseLocalDateTime } from "@/modules/scheduling/time";
import { getClinicorpStatus } from "@/modules/scheduling/clinicorp";
import { getCalendarFeatures } from "@/modules/scheduling/features";
import { AvailabilityUnavailableError } from "@/modules/scheduling/availability-error";

type Result = { ok: boolean; error?: string; info?: string; warning?: string };

function revalidateAgenda() {
  revalidatePath("/agenda");
  revalidatePath("/inicio");
}

/** Agente cuja configuração de horário vale para a conta (o principal). */
async function primaryAgentId(tenantId: string) {
  const agent = await prisma.agent.findFirst({
    where: { tenantId, archived: false },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  return agent?.id ?? null;
}

const newSchema = z.object({
  title: z.string().trim().min(1, "Dê um nome ao compromisso").max(120),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida"),
  time: z.string().regex(/^\d{1,2}:\d{2}$/, "Hora inválida"),
  durationMinutes: z.coerce.number().int().min(5).max(480),
  leadId: z.string().trim().optional(),
  notes: z.string().trim().max(500).optional(),
});

/**
 * Marcar um horário à mão.
 *
 * Fora do expediente é PERMITIDO aqui, ao contrário do que o agente pode fazer:
 * o dono do negócio encaixa um cliente às 20h quando quiser — a regra de
 * horário existe para o agente não prometer o que não deve, não para impedir o
 * humano. O conflito, esse, é bloqueado nos dois casos.
 */
export async function createManualAppointment(
  _prev: Result | null,
  formData: FormData,
): Promise<Result> {
  const tooLarge = payloadTooLarge(formData);
  if (tooLarge) return { ok: false, error: tooLarge };

  const { tenantId } = await requireTenant();
  const parsed = newSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }
  const { title, date, time, durationMinutes, notes } = parsed.data;

  const agentId = await primaryAgentId(tenantId);
  const cfg = agentId ? await getScheduleConfig(agentId) : null;
  const timezone = cfg?.timezone ?? "America/Sao_Paulo";

  const startsAt = parseLocalDateTime(date, time, timezone);
  if (!startsAt) return { ok: false, error: "Data ou hora inválida." };

  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
  try {
    if (await hasConflictAnywhere(tenantId, startsAt, endsAt, timezone)) {
      return { ok: false, error: "Já existe um compromisso nesse horário." };
    }
  } catch (err) {
    if (err instanceof AvailabilityUnavailableError) return { ok: false, error: err.message };
    throw err;
  }

  // Contato opcional — e sempre validado contra a conta, porque o id vem do
  // formulário. Contato de teste não pode ser agendado.
  let leadId: string | null = null;
  const [features, clinicorp] = await Promise.all([getCalendarFeatures(tenantId), getClinicorpStatus(tenantId)]);
  const requiresContact = features.clinicorpEnabled && clinicorp?.syncEnabled;
  if (requiresContact && !parsed.data.leadId) {
    return { ok: false, error: "Selecione um contato para enviar o horário ao Clinicorp." };
  }
  if (parsed.data.leadId) {
    const lead = await prisma.lead.findFirst({
      where: { id: parsed.data.leadId, tenantId, isTest: false },
      select: { id: true, phone: true },
    });
    if (!lead) return { ok: false, error: "Contato não encontrado." };
    if (requiresContact && !lead.phone?.replace(/\D/g, "")) {
      return { ok: false, error: "O contato precisa ter telefone para o agendamento no Clinicorp." };
    }
    leadId = lead.id;
  }

  const appointment = await createAppointment({
    tenantId,
    agentId,
    leadId,
    title,
    notes: notes ?? null,
    startsAt,
    durationMinutes,
    source: "manual",
    timezone,
  });

  revalidateAgenda();
  revalidatePath("/integracoes");
  if (appointment.clinicorpSync.status === "failed") {
    if (appointment.clinicorpSync.reason === "conflict") {
      return { ok: false, error: "O Clinicorp recusou esse horário porque já está ocupado. Nenhuma nova consulta foi confirmada. Escolha outro horário." };
    }
    return { ok: true, info: "Compromisso salvo no fechai.",
      warning: `O envio ao Clinicorp não foi confirmado. ${appointment.clinicorpSync.error} Não crie outro compromisso: confira a agenda da clínica e a integração.` };
  }
  return { ok: true, info: "Compromisso marcado." };
}

export async function cancelAppointmentAction(id: string): Promise<Result> {
  const { tenantId } = await requireTenant();
  const canceled = await cancelAppointment(tenantId, id);
  if (!canceled) return { ok: false, error: "Compromisso não encontrado." };
  revalidateAgenda();
  return { ok: true, info: "Compromisso cancelado." };
}

export async function completeAppointmentAction(id: string): Promise<Result> {
  const { tenantId } = await requireTenant();
  const ok = await markAppointmentDone(tenantId, id);
  if (!ok) return { ok: false, error: "Compromisso não encontrado." };
  revalidateAgenda();
  return { ok: true, info: "Marcado como realizado." };
}

// --------------------------------------------- lembretes de uma consulta

const reminderRuleSchema = z.object({
  minutesBefore: z.coerce.number().int()
    .min(1, "A antecedência mínima de um lembrete é 1 minuto.")
    .max(MAX_REMINDER_MINUTES, `A antecedência máxima de um lembrete é ${formatReminderLead(MAX_REMINDER_MINUTES)}.`),
  template: z.string().trim().max(500),
  sendTime: z.string().optional(),
});

/**
 * Lembretes só desta consulta, sobrescrevendo os do agente.
 *
 * Existe porque o padrão do agente serve ao caso comum, não a toda consulta:
 * um procedimento que exige preparo pede um aviso que a consulta de rotina
 * não pede. `reminders: null` devolve a consulta ao padrão do agente; uma
 * lista vazia é a escolha "esta não recebe lembrete", que é diferente — ver
 * `modules/scheduling/reminder-override.ts`.
 */
export async function saveAppointmentRemindersAction(
  id: string,
  reminders: ReminderRule[] | null,
): Promise<Result> {
  const { tenantId } = await requireTenant();

  if (reminders !== null) {
    const parsed = z.array(reminderRuleSchema).safeParse(reminders);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Lembretes inválidos." };
    }
    const error = validateReminders(parsed.data);
    if (error) return { ok: false, error };
  }

  // `updateMany` com o tenant no WHERE: o id vem do cliente, e sem essa
  // checagem trocar o id na requisição alcançaria a agenda de outra conta.
  const updated = await prisma.appointment.updateMany({
    where: { id, tenantId },
    data: {
      reminderOverride: serializeReminderOverride(reminders) ?? Prisma.DbNull,
      // Os disparos já enviados continuam marcados: mudar a régua não pode
      // fazer o paciente receber de novo um aviso que já recebeu. Os que
      // ainda não saíram passam a seguir a lista nova.
    },
  });
  if (updated.count === 0) return { ok: false, error: "Compromisso não encontrado." };

  revalidateAgenda();
  return {
    ok: true,
    info: reminders === null
      ? "Esta consulta voltou a seguir os lembretes do agente."
      : "Lembretes desta consulta salvos.",
  };
}
