import type { Prisma } from "@prisma/client";

/**
 * Origem das consultas que a recepção marcou direto no Clinicorp e a importação
 * trouxe para cá (`clinicorp-import.ts`). Estão na agenda para receber
 * lembrete — e o agente reconhecer a consulta quando o paciente responde —, não
 * porque o fechai as conseguiu.
 */
export const IMPORTED_SOURCE = "clinicorp";

/**
 * O que o fechai marcou (agente ou à mão), sem as importadas. Use em toda
 * métrica de resultado (agendamentos, IA × humano, ROI, atribuição de Disparo):
 * contar a agenda inteira da clínica como resultado do atendimento inflaria
 * tudo no dia em que a importação fosse ligada.
 *
 * E no conflito da agenda local: a ocupação do Clinicorp já é lida por
 * `hasClinicorpConflict`, com o filtro de profissional e a escolha de
 * `checkAvailability` da conta. Contar a cópia importada de novo bloquearia o
 * horário de um dentista pelo paciente de outro.
 */
export const NOT_IMPORTED = { source: { not: IMPORTED_SOURCE } } satisfies Prisma.AppointmentWhereInput;
