import type { LlmToolSchema } from "@/modules/ai";
import { isWithinBusinessHours, type ScheduleConfig } from "@/modules/scheduling/config";
import { cancelAppointment, findLeadAppointment, listUpcomingLeadAppointments, rescheduleAppointment } from "@/modules/scheduling/repository";
import { formatInZone, parseLocalDateTime } from "@/modules/scheduling/time";
import type { ToolContext } from "./tools";

export const SCHEDULING_TOOLS: LlmToolSchema[] = [
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

export async function runSchedulingTool(name: string, ctx: ToolContext, args: Record<string, unknown>, cfg: ScheduleConfig): Promise<string> {
  if (!schedulingToolAllowed(name, cfg)) return "Esta opção de agendamento está desabilitada. Ofereça atendimento humano.";
  if (name === "list_appointments") return leadAppointmentsContext(ctx, cfg);
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
  if (result.status === "conflict") return "O novo horário está ocupado. O horário original continua reservado. Combine outro horário e peça nova confirmação.";
  if (result.status === "unavailable") return "A consulta mudou ou não está mais disponível. Consulte os agendamentos novamente antes de confirmar qualquer alteração.";
  const when = formatInZone(startsAt, cfg.timezone);
  if (result.status === "unchanged") return `A consulta já está marcada para ${when}. Nenhuma alteração necessária.`;
  if (result.status === "rescheduled" && result.clinicorpSync.status === "failed") return `Reagendado no fechai para ${when}. O envio ao Clinicorp não foi confirmado; não reagende novamente nem afirme que já aparece no Clinicorp.`;
  return `Consulta reagendada para ${when}${cfg.location ? ` (${cfg.location})` : ""}. O horário anterior foi liberado.`;
}
