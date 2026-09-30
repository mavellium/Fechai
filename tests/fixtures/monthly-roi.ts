import { evaluateMonthlyMetrics, type MonthlyConversation, type MonthlyAppointment, type MonthlyReport } from "@/modules/reports/monthly";
import { EMPTY_ASSUMPTIONS, monthlyWindow, type MonthlyAssumptions } from "@/modules/reports/monthly-config";
import { monthlyQuality } from "@/modules/reports/monthly-quality";

export const roiConfig = (): MonthlyAssumptions => ({ ...EMPTY_ASSUMPTIONS,
  humanHours: [[], ...Array.from({ length: 5 }, () => [{ start: 540, end: 1080 }]), []],
  attendantMonthlyCents: 220_000, attendantMonthlyHours: 220, minutesPerConversation: 6,
  investmentCents: 10_000, procedures: [{ name: "Implante", ticketCents: 100_000, conversionBps: 5000 }],
  completedStatusTypes: ["REALIZADO_TESTE"],
});
export const roiConversation = (id = "outside", at = "2026-09-14T10:00:00Z"): MonthlyConversation => ({
  id, leadId: id, variables: { procedimento: "Implante" }, lead: { createdAt: new Date(at) }, firstInbound: new Date(at),
  messages: [{ id: `${id}-in`, role: "user", sentBy: null, createdAt: new Date(at) },
    { id: `${id}-reply`, role: "assistant", sentBy: "agent", createdAt: new Date(new Date(at).getTime() + 10_000) }],
});
export const roiAppointment = (id = "appointment", conversationId = "outside"): MonthlyAppointment => ({
  id, conversationId, leadId: conversationId, source: "agent", serviceType: "Avaliação", status: "done",
  startsAt: new Date("2026-09-15T15:00:00Z"), createdAt: new Date("2026-09-14T15:00:00Z"), clinicorpAppointmentId: null,
});
export function roiInput() {
  const window = monthlyWindow("2026-09", "America/Sao_Paulo");
  return { start: window.start, end: window.end, now: new Date("2026-10-01T12:00:00Z"), trackingSince: window.start,
    config: roiConfig(), conversations: [roiConversation()], appointments: [roiAppointment()],
    events: [{ conversationId: "outside", kind: "qualified", procedure: "Implante", createdAt: new Date("2026-09-14T15:00:00Z") }],
    clinicorp: { available: false, error: "Sem integração nesta amostra", appointments: [], statusTypes: [] },
  };
}
export function roiFixture(): MonthlyReport {
  const input = roiInput(), window = monthlyWindow("2026-09", input.config.timezone);
  const { metrics: current, evidence } = evaluateMonthlyMetrics(input);
  const report: MonthlyReport = { version: 1, tenantName: "Clínica de demonstração - dados fictícios", month: "2026-09", label: "setembro de 2026", previousMonth: "2026-08",
    generatedAt: input.now.toISOString(), dueAt: window.dueAt.toISOString(), partial: false,
    assumptions: input.config, previousAssumptions: input.config, previousConfigured: true,
    current, previous: { ...current, newContacts: 0, qualified: 0, roiPercent: -100 }, clinicorpError: null, clinicorpStatusTypes: [],
    adjustments: "Revisamos a abordagem de implantes e o convite para a avaliação. Ajustamos a explicação das formas de pagamento conforme a política da clínica.",
    nextMonth: "Conferir comparecimento com a recepção e acompanhar a conversão de avaliações em tratamentos. Rever os horários com maior procura.",
    decisionMaker: "Decisor de demonstração", status: "draft", finalizedAt: null, sentAt: null, meetingAt: null,
    automatic: { current, previous: { ...current, newContacts: 0, qualified: 0, roiPercent: -100 } }, evidence };
  report.quality = monthlyQuality(report);
  return report;
}
