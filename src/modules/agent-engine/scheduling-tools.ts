import type { LlmToolSchema } from "@/modules/ai";
import { isWithinBusinessHours, type ScheduleConfig } from "@/modules/scheduling/config";
import { cancelAppointment, findLeadAppointment, listFreeSlots, listUpcomingLeadAppointments, rescheduleAppointment } from "@/modules/scheduling/repository";
import { dayKeyInZone, formatInZone, parseLocalDateTime, partsInZone, timeInZone } from "@/modules/scheduling/time";
import type { ToolContext } from "./tools";
import { getWeeklyAvailability } from "@/modules/scheduling/weekly-availability";

export const SCHEDULING_TOOLS: LlmToolSchema[] = [
  {
    name: "list_available_slots",
    description: "Lista os horários LIVRES da agenda, já descontando consultas marcadas, pausas, expediente e antecedência mínima. Use sempre antes de sugerir ou aceitar um horário e ofereça somente horários desta lista. Não marca nada.",
    parameters: {
      type: "object",
      properties: {
        date: { type: "string", description: "Primeiro dia a consultar, AAAA-MM-DD" },
        days: { type: "number", description: "Quantos dias consultar a partir da data (1 a 7). Padrão 1." },
      },
      required: ["date"],
    },
  },
  {
    name: "list_appointments",
    description: "Consulta os próximos agendamentos deste contato. Use ao retornar, responder a lembretes ou pedir cancelamento/reagendamento. Não cria nem altera horários.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "cancel_meeting",
    description: "Cancela uma consulta deste contato. Primeiro identifique a consulta e pergunte se confirma o cancelamento da data/hora específica. Espere a próxima resposta clara do cliente; só então use confirmed=true. Dúvida ou fala vaga não é confirmação.",
    parameters: {
      type: "object",
      properties: {
        appointmentId: { type: "string", description: "ID retornado pela consulta de agendamentos" },
        confirmed: { type: "boolean", description: "True somente após o cliente responder claramente à pergunta de confirmação do cancelamento." },
      },
      required: ["appointmentId", "confirmed"],
    },
  },
  {
    name: "reschedule_meeting",
    description: "Troca a data/hora de uma consulta existente, preservando seu ID e sua duração. Confirme com o contato a consulta original e o novo horário, espere a resposta e só então use confirmed=true. Falha mantém o original.",
    parameters: {
      type: "object",
      properties: {
        appointmentId: { type: "string", description: "ID retornado pela consulta de agendamentos" },
        date: { type: "string", description: "Nova data AAAA-MM-DD" },
        time: { type: "string", description: "Nova hora HH:MM no fuso do negócio" },
        confirmed: { type: "boolean", description: "True somente após confirmação clara do cliente à pergunta sobre trocar o horário antigo pelo novo." },
      },
      required: ["appointmentId", "date", "time", "confirmed"],
    },
  },
];

export function schedulingToolAllowed(name: string, cfg: ScheduleConfig): boolean {
  return name === "list_appointments"
    || name === "list_available_slots"
    || (name === "cancel_meeting" && cfg.allowCancellation)
    || (name === "reschedule_meeting" && cfg.allowRescheduling);
}

export async function leadAppointmentsContext(ctx: Pick<ToolContext, "tenantId" | "leadId">, cfg: ScheduleConfig): Promise<string> {
  const appointments = await listUpcomingLeadAppointments(ctx.tenantId, ctx.leadId);
  if (!appointments.length) return "Nenhuma consulta futura deste contato na agenda do fechai.";
  // Só IDs e horários: títulos/notas livres não viram instruções de sistema.
  return "Consultas futuras deste contato na agenda do fechai:\n" + appointments.map((a) =>
    `- ID ${a.id}: ${formatInZone(a.startsAt, cfg.timezone)} (${Math.round((a.endsAt.getTime() - a.startsAt.getTime()) / 60_000)} min).`,
  ).join("\n");
}

/** "2026-09-16" + 2 -> "2026-09-18". Aritmética de calendário, sem fuso. */
function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function dayLabel(date: string, timeZone: string): string {
  const noon = parseLocalDateTime(date, "12:00", timeZone);
  return noon
    ? new Intl.DateTimeFormat("pt-BR", { timeZone, weekday: "short", day: "2-digit", month: "short" }).format(noon)
    : date;
}

export async function availableSlotsContext(ctx: Pick<ToolContext, "tenantId">, cfg: ScheduleConfig, date: string, days = 1): Promise<string> {
  if (!parseLocalDateTime(date, "12:00", cfg.timezone)) return "Data inválida. Use AAAA-MM-DD.";
  const count = Math.min(Math.max(Math.round(days) || 1, 1), 7);
  const dates = Array.from({ length: count }, (_, i) => addDays(date, i));
  const perDay = await Promise.all(dates.map((d) => listFreeSlots(ctx.tenantId, cfg, d)));

  const lines = dates.map((d, i) => {
    const slots = perDay[i];
    if (slots.length) return `- ${dayLabel(d, cfg.timezone)} (${d}): ${slots.map((s) => timeInZone(s, cfg.timezone)).join(", ")}`;
    const weekday = partsInZone(parseLocalDateTime(d, "12:00", cfg.timezone)!, cfg.timezone).weekday;
    return `- ${dayLabel(d, cfg.timezone)} (${d}): ${getWeeklyAvailability(cfg)[weekday].length ? "sem horário livre" : "não atendemos"}`;
  });
  // A grade é a da duração padrão: calcular uma por variação daria listas
  // diferentes para o mesmo dia e o agente não teria como escolher entre elas.
  // Um tipo mais curto cabe em qualquer início destes; um mais longo é recusado
  // por `schedule_meeting`, que já devolve os livres do dia junto.
  const note = cfg.durations.length
    ? ` Um tipo de atendimento mais longo pode não caber em todos eles — a checagem final é de schedule_meeting.`
    : "";
  return `Horários livres (grade de ${cfg.durationMinutes} min). Ofereça somente estes:${note}\n${lines.join("\n")}`;
}

/**
 * Complemento da recusa por conflito: já devolve o que está livre no mesmo dia,
 * para o agente não sugerir outro horário ocupado no chute. Nunca lança — a
 * recusa em si é o que importa.
 */
export async function freeSlotsHint(ctx: Pick<ToolContext, "tenantId">, cfg: ScheduleConfig, startsAt: Date): Promise<string> {
  try {
    const date = dayKeyInZone(startsAt, cfg.timezone);
    const slots = await listFreeSlots(ctx.tenantId, cfg, date);
    return slots.length
      ? ` Livres no mesmo dia: ${slots.map((s) => timeInZone(s, cfg.timezone)).join(", ")}. Ofereça somente um destes, ou use list_available_slots para outros dias.`
      : " Não há horário livre nesse dia. Use list_available_slots para os próximos dias antes de sugerir outro.";
  } catch (err) {
    console.error("[tools] horários livres falhou", err);
    return " Use list_available_slots antes de sugerir outro horário.";
  }
}

export async function runSchedulingTool(name: string, ctx: ToolContext, args: Record<string, unknown>, cfg: ScheduleConfig): Promise<string> {
  if (!schedulingToolAllowed(name, cfg)) return "Esta opção de agendamento está desabilitada. Ofereça atendimento humano.";
  if (name === "list_appointments") return leadAppointmentsContext(ctx, cfg);
  if (name === "list_available_slots") {
    if (typeof args.date !== "string") return "Informe a data em AAAA-MM-DD.";
    return availableSlotsContext(ctx, cfg, args.date.trim(), typeof args.days === "number" ? args.days : 1);
  }
  if (typeof args.appointmentId !== "string" || !args.appointmentId.trim()) return "Consulte os agendamentos do contato e identifique a consulta antes de alterar.";
  const appointment = await findLeadAppointment(ctx.tenantId, ctx.leadId, args.appointmentId);
  if (!appointment) return "Consulta não encontrada para este contato. Consulte os agendamentos novamente.";
  if (name === "cancel_meeting" && appointment.status === "canceled") return "Essa consulta já está cancelada. Não é necessário cancelar novamente.";
  if (appointment.status !== "scheduled" || appointment.startsAt <= new Date()) return "Essa consulta não está disponível para alteração. Consulte os próximos horários do contato.";
  const previous = formatInZone(appointment.startsAt, cfg.timezone);
  if (args.confirmed !== true) return `Nenhuma alteração foi feita. Confirme com o cliente a ${name === "cancel_meeting" ? "exclusão" : "troca"} da consulta de ${previous} e espere a resposta clara antes de chamar novamente com confirmed=true.`;

  if (name === "cancel_meeting") {
    const canceled = await cancelAppointment(ctx.tenantId, appointment.id, ctx.leadId);
    return canceled ? `Cancelamento feito para ${previous}. Encerre com gentileza e se coloque à disposição.` : "A consulta mudou enquanto conversávamos. Consulte novamente antes de confirmar o cancelamento.";
  }

  const startsAt = typeof args.date === "string" && typeof args.time === "string"
    ? parseLocalDateTime(args.date, args.time, cfg.timezone) : null;
  if (!startsAt) return "Nova data/hora inválida. O horário original continua reservado.";
  if (startsAt.getTime() === appointment.startsAt.getTime()) return `A consulta já está marcada para ${previous}. Nenhuma alteração necessária.`;
  if (startsAt.getTime() < Date.now() + cfg.minNoticeHours * 3_600_000) return "O novo horário já passou ou não respeita a antecedência mínima. O horário original continua reservado.";
  const durationMinutes = (appointment.endsAt.getTime() - appointment.startsAt.getTime()) / 60_000;
  if (!isWithinBusinessHours(startsAt, { ...cfg, durationMinutes })) return "O novo horário fica fora do expediente ou atravessa uma pausa. O horário original continua reservado. Combine outro horário.";
  const result = await rescheduleAppointment({ tenantId: ctx.tenantId, leadId: ctx.leadId, id: appointment.id, startsAt, timezone: cfg.timezone });
  if (result.status === "conflict") return `O novo horário está ocupado. O horário original continua reservado.${await freeSlotsHint(ctx, cfg, startsAt)} Peça nova confirmação.`;
  if (result.status === "unavailable") return "A consulta mudou ou não está mais disponível. Consulte os agendamentos novamente antes de confirmar qualquer alteração.";
  const when = formatInZone(startsAt, cfg.timezone);
  if (result.status === "unchanged") return `A consulta já está marcada para ${when}. Nenhuma alteração necessária.`;
  if (result.status === "rescheduled" && result.clinicorpSync.status === "failed") return `Reagendado no fechai para ${when}. O envio ao Clinicorp não foi confirmado; não reagende novamente nem afirme que já aparece no Clinicorp.`;
  return `Consulta reagendada para ${when}${cfg.location ? ` (${cfg.location})` : ""}. O horário anterior foi liberado.`;
}
