"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import {
  cancelAppointment,
  createAppointment,
  getScheduleConfig,
  hasConflict,
  markAppointmentDone,
} from "@/modules/scheduling/repository";
import { disconnectGoogleCalendar } from "@/modules/scheduling/google";
import { parseLocalDateTime } from "@/modules/scheduling/time";

type Result = { ok: boolean; error?: string; info?: string };

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
  if (await hasConflict(tenantId, startsAt, endsAt)) {
    return { ok: false, error: "Já existe um compromisso nesse horário." };
  }

  // Contato opcional — e sempre validado contra a conta, porque o id vem do
  // formulário. Contato de teste não pode ser agendado.
  let leadId: string | null = null;
  if (parsed.data.leadId) {
    const lead = await prisma.lead.findFirst({
      where: { id: parsed.data.leadId, tenantId, isTest: false },
      select: { id: true },
    });
    if (!lead) return { ok: false, error: "Contato não encontrado." };
    leadId = lead.id;
  }

  await createAppointment({
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

/** Desliga o espelhamento sem desfazer a autorização do Google. */
export async function setGoogleSyncEnabled(enabled: boolean): Promise<Result> {
  const { tenantId } = await requireTenant();
  const { count } = await prisma.calendarIntegration.updateMany({
    where: { tenantId },
    data: { syncEnabled: enabled },
  });
  if (count === 0) return { ok: false, error: "Google Agenda não está conectado." };
  revalidateAgenda();
  return { ok: true };
}

export async function disconnectGoogleAction(): Promise<Result> {
  const { tenantId } = await requireTenant();
  await disconnectGoogleCalendar(tenantId);
  revalidateAgenda();
  return { ok: true, info: "Google Agenda desconectado." };
}
