import { prisma } from "@/lib/prisma";
import { readClinicorpReport, type ClinicorpReportData } from "@/modules/scheduling/clinicorp";
import { dayKeyInZone, partsInZone } from "@/modules/scheduling/time";
import { applyMonthlyOverrides, parseMonthlyOverrides, type MonthlyOverrides } from "./monthly-overrides";
import { EMPTY_ASSUMPTIONS, monthlyWindow, normalizeLabel, outsideHumanHours,
  parseMonthlyAssumptions, type MonthlyAssumptions } from "./monthly-config";

export type SplitCount = { inside: number; outside: number; unclassified: number };
export type MonthlyMetrics = {
  newContacts: number; conversations: SplitCount; firstResponseSeconds: number | null;
  scheduled: SplitCount; attended: SplitCount; attendanceUnknown: number; untypedAppointments: number;
  qualified: number; handoffs: number; unanswered: number; trackingComplete: boolean;
  aiOnlyConversations: number; assumedHours: number | null;
  procedures: { name: string; qualified: number; attendedOutside: number; revenueCents: number | null }[];
  peaks: { hour: number; messages: number }[]; revenueCents: number | null; savingsCents: number | null;
  investmentCents: number | null; roiPercent: number | null; missing: string[];
};
export type MonthlyReport = {
  version: 1; tenantName: string; month: string; label: string; previousMonth: string;
  generatedAt: string; dueAt: string; partial: boolean; assumptions: MonthlyAssumptions;
  assumptionsFromMonth?: string;
  revision?: string; metricOverrides?: MonthlyOverrides;
  automatic?: { current: MonthlyMetrics; previous: MonthlyMetrics };
  previousAssumptions: MonthlyAssumptions; previousConfigured: boolean;
  current: MonthlyMetrics; previous: MonthlyMetrics; clinicorpError: string | null;
  clinicorpStatusTypes: ClinicorpReportData["statusTypes"];
  adjustments: string; nextMonth: string; decisionMaker: string;
  status: string; finalizedAt: string | null; sentAt: string | null; meetingAt: string | null;
};

type Msg = { id: string; role: string; sentBy: string | null; createdAt: Date };
export type MonthlyConversation = { id: string; leadId: string; lead: { createdAt: Date };
  variables: unknown; messages: Msg[]; firstInbound: Date | null };
export type MonthlyAppointment = { id: string; conversationId: string | null; leadId: string | null;
  source: string; serviceType: string | null; status: string; startsAt: Date; createdAt: Date;
  clinicorpAppointmentId: string | null };
export type MonthlyEvent = { conversationId: string; kind: string; procedure: string | null; createdAt: Date };

function addSplit(split: SplitCount, at: Date | null, config: MonthlyAssumptions) {
  const outside = at ? outsideHumanHours(at, config) : null;
  split[outside === null ? "unclassified" : outside ? "outside" : "inside"]++;
}
const split = (): SplitCount => ({ inside: 0, outside: 0, unclassified: 0 });
const inRange = (at: Date, start: Date, end: Date) => at >= start && at < end;
function procedureOf(conversation: MonthlyConversation | undefined, config: MonthlyAssumptions): string | null {
  const raw = conversation?.variables;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = (raw as Record<string, unknown>)[config.procedureVariable];
  if (typeof value !== "string" || !value.trim()) return null;
  return config.procedures.find((p) => normalizeLabel(p.name) === normalizeLabel(value))?.name ?? value.trim();
}

/** Função pura compartilhada pelo painel, fechamento e PDF. Valores em centavos. */
export function calculateMonthlyMetrics(input: {
  start: Date; end: Date; now: Date; trackingSince: Date; accountCreatedAt?: Date; config: MonthlyAssumptions;
  conversations: MonthlyConversation[]; appointments: MonthlyAppointment[]; events: MonthlyEvent[];
  clinicorp: ClinicorpReportData;
}): MonthlyMetrics {
  const { start, end, now, config, conversations, appointments, events, clinicorp } = input;
  const current: MonthlyMetrics = { newContacts: 0, conversations: split(), firstResponseSeconds: null,
    scheduled: split(), attended: split(), attendanceUnknown: 0, untypedAppointments: 0,
    qualified: 0, handoffs: 0, unanswered: 0, trackingComplete: input.trackingSince.getTime() <= Math.max(start.getTime(), input.accountCreatedAt?.getTime() ?? start.getTime()),
    aiOnlyConversations: 0, assumedHours: null, procedures: [], peaks: [],
    revenueCents: null, savingsCents: null, investmentCents: config.investmentCents, roiPercent: null, missing: [] };
  const byConversation = new Map(conversations.map((c) => [c.id, c]));
  const byLead = new Map(conversations.map((c) => [c.leadId, c]));
  const responseTimes: number[] = [];
  const hourCounts = new Map<number, number>();
  for (const conversation of conversations) {
    const messages = conversation.messages.filter((m) => inRange(m.createdAt, start, end));
    let pending: Date | null = null;
    // Uma chegada no fim do mês pode ser respondida no começo do seguinte.
    for (const message of conversation.messages.filter((m) => m.createdAt < start)) {
      if (message.role === "user") pending ??= message.createdAt;
      if (message.role === "assistant" && ["agent", "human"].includes(message.sentBy ?? "")) pending = null;
    }
    let firstPair: { inbound: Date; reply: Msg } | null = null;
    let answeredByAgent = false;
    let answeredByHuman = false;
    for (const message of messages) {
      if (message.role === "user") {
        pending ??= message.createdAt;
        const hour = partsInZone(message.createdAt, config.timezone).hour;
        hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1);
      } else if (message.role === "assistant" && pending && ["agent", "human"].includes(message.sentBy ?? "")) {
        firstPair ??= { inbound: pending, reply: message };
        if (message.sentBy === "agent") answeredByAgent = true;
        if (message.sentBy === "human") answeredByHuman = true;
        pending = null;
      }
      if (message.role === "assistant" && message.sentBy === "human") answeredByHuman = true;
    }
    if (firstPair) responseTimes.push((firstPair.reply.createdAt.getTime() - firstPair.inbound.getTime()) / 1000);
    if (!answeredByAgent) continue;
    addSplit(current.conversations, firstPair?.inbound ?? null, config);
    if (inRange(conversation.lead.createdAt, start, end)) current.newContacts++;
    if (!answeredByHuman) current.aiOnlyConversations++;
  }
  current.firstResponseSeconds = responseTimes.length ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length : null;
  current.peaks = [...hourCounts].map(([hour, messages]) => ({ hour, messages })).sort((a, b) => b.messages - a.messages || a.hour - b.hour).slice(0, 3);

  const procedures = new Map<string, { qualified: Set<string>; attendedOutside: number }>();
  const getProcedure = (name: string | null) => {
    const key = name ?? "Não informado";
    const existing = [...procedures.keys()].find((p) => normalizeLabel(p) === normalizeLabel(key));
    if (existing) return procedures.get(existing)!;
    const value = { qualified: new Set<string>(), attendedOutside: 0 };
    procedures.set(key, value);
    return value;
  };
  const qualified = new Set<string>();
  for (const event of events.filter((e) => inRange(e.createdAt, start, end))) {
    if (event.kind === "handoff") current.handoffs++;
    if (event.kind === "unanswered") current.unanswered++;
    if (event.kind === "qualified") {
      qualified.add(event.conversationId);
      const explicit = event.procedure;
      const name = explicit ? config.procedures.find((p) => normalizeLabel(p.name) === normalizeLabel(explicit))?.name ?? explicit
        : procedureOf(byConversation.get(event.conversationId), config);
      getProcedure(name).qualified.add(event.conversationId);
    }
  }
  current.qualified = qualified.size;
  const external = new Map(clinicorp.appointments.map((a) => [a.id, a]));
  for (const appointment of appointments) {
    if (appointment.source !== "agent" || appointment.status === "canceled") continue;
    const relevant = inRange(appointment.createdAt, start, end) || inRange(appointment.startsAt, start, end);
    if (!relevant) continue;
    const evaluation = appointment.serviceType
      ? config.evaluationTypes.some((t) => normalizeLabel(t) === normalizeLabel(appointment.serviceType!))
      : config.countUntypedAsEvaluations;
    if (!appointment.serviceType && !config.countUntypedAsEvaluations) current.untypedAppointments++;
    if (!evaluation) continue;
    const conversation = appointment.conversationId ? byConversation.get(appointment.conversationId) : byLead.get(appointment.leadId ?? "");
    // Receita usa a chegada do contato, jamais a hora da consulta/criação.
    const origin = conversation?.firstInbound && conversation.firstInbound <= appointment.createdAt ? conversation.firstInbound : null;
    if (inRange(appointment.createdAt, start, end)) addSplit(current.scheduled, origin, config);
    if (!inRange(appointment.startsAt, start, end) || appointment.startsAt > now) continue;
    const remote = appointment.clinicorpAppointmentId ? external.get(appointment.clinicorpAppointmentId) : undefined;
    if (remote?.canceled) continue;
    let attended: boolean | null = appointment.status === "done" ? true : null;
    if (appointment.clinicorpAppointmentId) {
      // Se há espelho, conferir lá é obrigatório, mesmo com status local antigo.
      attended = remote?.statusType && config.completedStatusTypes.length
        ? config.completedStatusTypes.includes(remote.statusType) : null;
    }
    if (attended === null) { current.attendanceUnknown++; continue; }
    if (!attended) continue;
    addSplit(current.attended, origin, config);
    if (origin && outsideHumanHours(origin, config) === true) getProcedure(procedureOf(conversation, config)).attendedOutside++;
  }
  current.procedures = [...procedures].map(([name, value]) => {
    return { name, qualified: value.qualified.size, attendedOutside: value.attendedOutside, revenueCents: null };
  }).sort((a, b) => b.qualified - a.qualified || b.attendedOutside - a.attendedOutside);
  return applyMonthlyOverrides(current, {}, config);
}

export async function computeMonthlyReport(tenantId: string, month: string, useSnapshot = true): Promise<MonthlyReport> {
  const [tenant, saved] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, createdAt: true, reportTrackingStartedAt: true } }),
    prisma.monthlyRoiReport.findUnique({ where: { tenantId_month: { tenantId, month } } }),
  ]);
  if (useSnapshot && saved?.status === "ready" && saved.snapshot) {
    const snapshot = saved.snapshot as unknown as MonthlyReport;
    if (snapshot.version === 1 && snapshot.month === month) return { ...snapshot,
      revision: saved.updatedAt?.toISOString(), status: saved.status, finalizedAt: saved.finalizedAt?.toISOString() ?? null,
      sentAt: saved.sentAt?.toISOString() ?? null, meetingAt: saved.meetingAt?.toISOString() ?? null };
  }
  const inherited = saved ? null : await prisma.monthlyRoiReport.findFirst({
    where: { tenantId, month: { lt: month } }, orderBy: { month: "desc" },
    select: { month: true, assumptions: true },
  });
  const assumptions = parseMonthlyAssumptions(saved?.assumptions ?? inherited?.assumptions ?? EMPTY_ASSUMPTIONS);
  const window = monthlyWindow(month, assumptions.timezone);
  const previousSaved = await prisma.monthlyRoiReport.findUnique({ where: { tenantId_month: { tenantId, month: window.previousMonth } } });
  const reopened = saved?.status === "draft" && saved.snapshot ? saved.snapshot as unknown as MonthlyReport : null;
  const previousBase = reopened?.version === 1 && reopened.month === month && reopened.previousMonth === window.previousMonth ? reopened : null;
  const previousAssumptions = previousBase?.previousAssumptions ?? parseMonthlyAssumptions(previousSaved?.assumptions ?? EMPTY_ASSUMPTIONS);
  const previousWindow = monthlyWindow(window.previousMonth, previousAssumptions.timezone);
  const start = new Date(Math.min(window.start.getTime(), previousWindow.start.getTime()));
  const end = new Date(Math.max(window.end.getTime(), previousWindow.end.getTime()));
  const [rawConversations, appointments, events, clinicorp] = await Promise.all([
    prisma.conversation.findMany({ where: { tenantId, isTest: false, lead: { isTest: false }, OR: [
      { messages: { some: { createdAt: { gte: start, lt: end } } } },
      { appointments: { some: { OR: [{ startsAt: { gte: start, lt: end } }, { createdAt: { gte: start, lt: end } }] } } },
      { reportEvents: { some: { createdAt: { gte: start, lt: end } } } },
    ] }, select: { id: true, leadId: true, lead: { select: { createdAt: true } }, variables: true,
      messages: { where: { createdAt: { gte: start, lt: end }, role: { in: ["user", "assistant"] } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, role: true, sentBy: true, createdAt: true } } } }),
    prisma.appointment.findMany({ where: { tenantId, source: "agent", lead: { isTest: false },
      OR: [{ startsAt: { gte: start, lt: end } }, { createdAt: { gte: start, lt: end } }] },
      select: { id: true, conversationId: true, leadId: true, source: true, serviceType: true, status: true,
        startsAt: true, createdAt: true, clinicorpAppointmentId: true } }),
    prisma.reportEvent.findMany({ where: { tenantId, createdAt: { gte: start, lt: end }, conversation: { isTest: false, lead: { isTest: false } } },
      select: { conversationId: true, kind: true, procedure: true, createdAt: true } }),
    readClinicorpReport(tenantId, dayKeyInZone(start, assumptions.timezone), dayKeyInZone(new Date(end.getTime() - 1), assumptions.timezone)),
  ]);
  // Uma consulta agregada evita buscar todo o histórico só para descobrir a chegada.
  const firstInbound = rawConversations.length ? await prisma.message.groupBy({ by: ["conversationId"],
    where: { role: "user", conversation: { tenantId, isTest: false, lead: { isTest: false } }, conversationId: { in: rawConversations.map((c) => c.id) } }, _min: { createdAt: true } }) : [];
  const firstById = new Map(firstInbound.map((r) => [r.conversationId, r._min.createdAt]));
  const conversations = rawConversations.map((c) => ({ ...c, firstInbound: firstById.get(c.id) ?? null }));
  const now = new Date();
  const trackingSince = new Date(Math.max(tenant.createdAt.getTime(), tenant.reportTrackingStartedAt.getTime()));
  const automaticCurrent = calculateMonthlyMetrics({ start: window.start, end: window.end, now, trackingSince, accountCreatedAt: tenant.createdAt, config: assumptions, conversations, appointments, events, clinicorp });
  const previousSnapshot = previousSaved?.status === "ready" && previousSaved.snapshot ? previousSaved.snapshot as unknown as MonthlyReport : null;
  const previousAuto = calculateMonthlyMetrics({ start: previousWindow.start, end: previousWindow.end, now, trackingSince, accountCreatedAt: tenant.createdAt, config: previousAssumptions, conversations, appointments, events, clinicorp });
  const automaticPrevious = previousBase?.previous ?? (previousSnapshot?.version === 1 ? previousSnapshot.current : applyMonthlyOverrides(previousAuto, parseMonthlyOverrides(previousSaved?.assumptions).current, previousAssumptions));
  const metricOverrides = parseMonthlyOverrides(saved?.assumptions);
  const current = applyMonthlyOverrides(automaticCurrent, metricOverrides.current, assumptions);
  // Um comparativo fechado conserva sua base financeira quando não houve correção.
  const previous = Object.keys(metricOverrides.previous).length ? applyMonthlyOverrides(automaticPrevious, metricOverrides.previous, previousAssumptions) : automaticPrevious;
  return { version: 1, tenantName: tenant.name, month, label: new Intl.DateTimeFormat("pt-BR", { timeZone: assumptions.timezone, month: "long", year: "numeric" }).format(window.start),
    previousMonth: window.previousMonth, generatedAt: now.toISOString(), dueAt: window.dueAt.toISOString(), partial: now < window.end,
    assumptions, ...(inherited ? { assumptionsFromMonth: inherited.month } : {}), revision: saved?.updatedAt?.toISOString(), metricOverrides,
    automatic: { current: automaticCurrent, previous: automaticPrevious }, previousAssumptions, previousConfigured: previousBase?.previousConfigured ?? Boolean(previousSaved), current, previous,
    clinicorpError: clinicorp.error, clinicorpStatusTypes: clinicorp.statusTypes,
    adjustments: saved?.adjustments ?? "", nextMonth: saved?.nextMonth ?? "", decisionMaker: saved?.decisionMaker ?? "",
    status: saved?.status ?? "draft", finalizedAt: saved?.finalizedAt?.toISOString() ?? null,
    sentAt: saved?.sentAt?.toISOString() ?? null, meetingAt: saved?.meetingAt?.toISOString() ?? null };
}
