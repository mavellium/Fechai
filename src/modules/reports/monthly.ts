import { prisma } from "@/lib/prisma";
import { readClinicorpReport, type ClinicorpReportData } from "@/modules/scheduling/clinicorp";
import { dayKeyInZone, partsInZone } from "@/modules/scheduling/time";
import { attendanceOf, parseKind } from "@/modules/scheduling/dimensions";
import { applyMonthlyOverrides, parseMonthlyOverrides, type MonthlyOverrides } from "./monthly-overrides";
import { monthlyAccountPrice, sameMonthlyAgentScope } from "./monthly-import";
import { EMPTY_ASSUMPTIONS, monthlyWindow, normalizeLabel, outsideHumanHours,
  parseMonthlyAssumptions, type MonthlyAssumptions } from "./monthly-config";
import { calculateTimeMetrics, LONG_AUDIO_SECONDS, type MonthlyTimeMetrics, type TimeMessage } from "./monthly-time";
import { UNTRANSCRIBED_AUDIO } from "@/modules/voice/received-audio";
import { loadLeadQualityDetail } from "@/modules/lead-insights/queries";
import type { LeadQuality } from "@/modules/lead-insights/summary";
import { capEvidence, emptyEvidence, type AppointmentEvidence, type Bucket, type EventEvidence, type MonthlyEvidence } from "./monthly-evidence";
import { monthlyQuality, type MonthlyQuality } from "./monthly-quality";
import { monthlyLimitations, type MonthlyLimitation } from "./monthly-limitations";
import { parseNextActions, type MonthlyNextAction } from "./monthly-next-actions";

export type SplitCount = { inside: number; outside: number; unclassified: number };
export type MonthlyMetrics = {
  newContacts: number; conversations: SplitCount; firstResponseSeconds: number | null;
  scheduled: SplitCount; attended: SplitCount; attendanceUnknown: number; untypedAppointments: number;
  qualified: number; handoffs: number; unanswered: number; trackingComplete: boolean;
  /**
   * Fila de perguntas sem resposta (P-87): aprovadas no mês e o tempo médio
   * entre a primeira vez que perguntaram e a aprovação. Opcionais porque
   * snapshots fechados antes da fila não os têm — ausente é "sem dado", não zero.
   */
  gapsAnswered?: number; gapAnswerSeconds?: number | null;
  aiOnlyConversations: number; assumedHours: number | null;
  /**
   * "Tempo que o Fechai devolveu": áudios, mensagens e duração dos atendimentos
   * (`monthly-time.ts`). Opcional porque snapshots fechados antes dele não o têm.
   */
  time?: MonthlyTimeMetrics;
  procedures: { name: string; qualified: number; attendedOutside: number; revenueCents: number | null }[];
  peaks: { hour: number; messages: number }[]; revenueCents: number | null; savingsCents: number | null;
  investmentCents: number | null; roiPercent: number | null; missing: string[];
};
export type MonthlyReport = {
  version: 1; tenantName: string; month: string; label: string; previousMonth: string;
  generatedAt: string; dueAt: string; partial: boolean; assumptions: MonthlyAssumptions;
  assumptionsFromMonth?: string;
  investmentSource?: string;
  agentNames?: string[];
  revision?: string; metricOverrides?: MonthlyOverrides;
  automatic?: { current: MonthlyMetrics; previous: MonthlyMetrics };
  previousAssumptions: MonthlyAssumptions; previousConfigured: boolean;
  current: MonthlyMetrics; previous: MonthlyMetrics; clinicorpError: string | null;
  clinicorpStatusTypes: ClinicorpReportData["statusTypes"];
  clinicorpIntegrationState?: ClinicorpReportData["integrationState"];
  adjustments: string; nextMonth: string; decisionMaker: string;
  /** Caso real do mês, anonimizado. Ausente em snapshots anteriores ao campo. */
  featuredCase?: string;
  /**
   * Qualidade dos leads do mês (cidade, raio, dúvidas, motivos de perda,
   * sugestões de tráfego). Congelada no snapshot; relatórios fechados antes
   * dela não a têm — ausente é "sem registro", nunca zero.
   */
  leadQuality?: LeadQuality;
  /**
   * Os registros de cada número do mês (`monthly-evidence.ts`) e o selo de
   * qualidade de cada indicador (`monthly-quality.ts`). Congelados no snapshot;
   * relatórios fechados antes deles não os têm e o painel/PDF escondem os dois.
   */
  evidence?: MonthlyEvidence;
  quality?: MonthlyQuality;
  /**
   * Destaques (parte 3) e a explicação das limitações, escritos na revisão.
   * `limitations` é a lista calculada (`monthly-limitations.ts`) do que ficou
   * sem evidência; congelada no snapshot. Os três ausentes em fechamentos
   * anteriores ao assistente de fechamento — o painel e o PDF escondem.
   */
  highlights?: string;
  limitationsNote?: string;
  /** Próximas ações da página 1; ausente em relatórios antigos, que usam `nextMonth`. */
  nextActions?: MonthlyNextAction[];
  limitations?: MonthlyLimitation[];
  status: string; finalizedAt: string | null; sentAt: string | null; meetingAt: string | null;
};

type Msg = { id: string; role: string; sentBy: string | null; createdAt: Date; audio?: TimeMessage["audio"] };
export type MonthlyConversation = { id: string; agentId?: string | null; leadId: string;
  lead: { createdAt: Date; status?: string; disqualifiedAt?: Date | null };
  variables: unknown; messages: Msg[]; firstInbound: Date | null };
export type MonthlyAppointment = { id: string; agentId?: string | null; conversationId: string | null; leadId: string | null;
  source: string; serviceType: string | null; status: string; startsAt: Date; createdAt: Date;
  /** Dimensões explícitas (`scheduling/dimensions.ts`); ausentes em fixtures antigas = não informadas. */
  kind?: string | null; procedure?: string | null;
  attendance?: string | null; attendanceAt?: Date | null;
  clinicorpAppointmentId: string | null };
export type MonthlyEvent = { id?: string; conversationId: string; kind: string; procedure: string | null; createdAt: Date };
export type MonthlyGap = { id?: string; agentId: string | null; firstAskedAt: Date; answeredAt: Date };

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

export type MonthlyInput = {
  start: Date; end: Date; now: Date; trackingSince: Date; accountCreatedAt?: Date; config: MonthlyAssumptions;
  conversations: MonthlyConversation[]; appointments: MonthlyAppointment[]; events: MonthlyEvent[];
  gaps?: MonthlyGap[];
  clinicorp: ClinicorpReportData;
};

/** Função pura compartilhada pelo painel, fechamento e PDF. Valores em centavos. */
export function calculateMonthlyMetrics(input: MonthlyInput): MonthlyMetrics {
  return evaluateMonthlyMetrics(input).metrics;
}

const bucketOf = (at: Date | null, config: MonthlyAssumptions): Bucket => {
  const outside = at ? outsideHumanHours(at, config) : null;
  return outside === null ? "unclassified" : outside ? "outside" : "inside";
};

/**
 * Os números do mês e os registros que os compõem, na mesma passada: cada
 * `continue` que tira um registro da conta também anota o motivo. Nunca
 * reconstrua a lista com outra consulta — é exatamente a divergência que ela
 * existe para explicar.
 */
export function evaluateMonthlyMetrics(input: MonthlyInput): { metrics: MonthlyMetrics; evidence: MonthlyEvidence } {
  const { start, end, now, config, conversations, appointments, events, clinicorp } = input;
  const evidence = emptyEvidence();
  const iso = (at: Date | null) => at?.toISOString() ?? null;
  const includesAgent = (agentId?: string | null) => !config.agentIds?.length || Boolean(agentId && config.agentIds.includes(agentId));
  // O procedimento registrado na consulta vence a variável da conversa.
  const procedureName = (a: MonthlyAppointment, c?: MonthlyConversation) => a.procedure?.trim()
    ? config.procedures.find((p) => normalizeLabel(p.name) === normalizeLabel(a.procedure!))?.name ?? a.procedure.trim()
    : procedureOf(c, config);
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
    if (!includesAgent(conversation.agentId)) continue;
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
    let inbound = 0;
    for (const message of messages) {
      if (message.role === "user") {
        inbound++;
        pending ??= message.createdAt;
        const hour = partsInZone(message.createdAt, config.timezone).hour;
        hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1);
        evidence.hours[hour]++;
      } else if (message.role === "assistant" && pending && ["agent", "human"].includes(message.sentBy ?? "")) {
        firstPair ??= { inbound: pending, reply: message };
        if (message.sentBy === "agent") answeredByAgent = true;
        if (message.sentBy === "human") answeredByHuman = true;
        pending = null;
      }
      if (message.role === "assistant" && message.sentBy === "human") answeredByHuman = true;
    }
    if (firstPair) {
      const seconds = (firstPair.reply.createdAt.getTime() - firstPair.inbound.getTime()) / 1000;
      responseTimes.push(seconds);
      evidence.responses.push({ conversationId: conversation.id, inboundAt: firstPair.inbound.toISOString(),
        replyAt: firstPair.reply.createdAt.toISOString(), seconds, by: firstPair.reply.sentBy === "agent" ? "agent" : "human" });
    }
    const newContact = inRange(conversation.lead.createdAt, start, end);
    const arrival = firstPair?.inbound ?? null;
    // Conversa só com mensagem nossa no mês (follow-up, lembrete) não é atendimento.
    if (answeredByAgent || inbound > 0) evidence.conversations.push({ conversationId: conversation.id, arrivalAt: iso(arrival),
      bucket: bucketOf(arrival, config), counted: answeredByAgent, excluded: answeredByAgent ? null : answeredByHuman ? "human_only" : "no_reply",
      newContact, aiOnly: !answeredByHuman });
    if (!answeredByAgent) continue;
    addSplit(current.conversations, arrival, config);
    if (newContact) current.newContacts++;
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
    if (!includesAgent(byConversation.get(event.conversationId)?.agentId)) continue;
    const row = (procedure: string | null = null) => evidence.events.push({ eventId: event.id ?? "", conversationId: event.conversationId,
      kind: event.kind as EventEvidence["kind"], at: event.createdAt.toISOString(), procedure });
    if (event.kind === "handoff") { current.handoffs++; row(); }
    if (event.kind === "unanswered") { current.unanswered++; row(); }
    if (event.kind === "qualified") {
      qualified.add(event.conversationId);
      const explicit = event.procedure;
      const name = explicit ? config.procedures.find((p) => normalizeLabel(p.name) === normalizeLabel(explicit))?.name ?? explicit
        : procedureOf(byConversation.get(event.conversationId), config);
      getProcedure(name).qualified.add(event.conversationId);
      row(name);
    }
  }
  current.qualified = qualified.size;
  // Tempo de resposta da equipe entra no mês da APROVAÇÃO: é quando a
  // pergunta deixou de estar sem resposta.
  const answeredGaps = (input.gaps ?? []).filter((g) => inRange(g.answeredAt, start, end) && includesAgent(g.agentId));
  current.gapsAnswered = answeredGaps.length;
  current.gapAnswerSeconds = answeredGaps.length
    ? answeredGaps.reduce((sum, g) => sum + (g.answeredAt.getTime() - g.firstAskedAt.getTime()) / 1000, 0) / answeredGaps.length
    : null;
  for (const g of answeredGaps) evidence.gaps.push({ gapId: g.id ?? "", firstAskedAt: g.firstAskedAt.toISOString(),
    answeredAt: g.answeredAt.toISOString(), seconds: (g.answeredAt.getTime() - g.firstAskedAt.getTime()) / 1000 });
  const external = new Map(clinicorp.appointments.map((a) => [a.id, a]));
  for (const appointment of appointments) {
    if (!includesAgent(appointment.agentId)) continue;
    // Marcação manual não é do agente: nem entra na lista do relatório.
    if (appointment.source !== "agent") continue;
    const createdInMonth = inRange(appointment.createdAt, start, end), startsInMonth = inRange(appointment.startsAt, start, end);
    if (!createdInMonth && !startsInMonth) continue;
    const conversation = appointment.conversationId ? byConversation.get(appointment.conversationId) : byLead.get(appointment.leadId ?? "");
    // Receita usa a chegada do contato, jamais a hora da consulta/criação.
    const origin = conversation?.firstInbound && conversation.firstInbound <= appointment.createdAt ? conversation.firstInbound : null;
    const remote = appointment.clinicorpAppointmentId ? external.get(appointment.clinicorpAppointmentId) : undefined;
    const row: AppointmentEvidence = { appointmentId: appointment.id, conversationId: conversation?.id ?? appointment.conversationId,
      createdAt: appointment.createdAt.toISOString(), startsAt: appointment.startsAt.toISOString(), createdInMonth, startsInMonth,
      serviceType: appointment.serviceType, kind: appointment.kind ?? null, status: appointment.status, procedure: procedureName(appointment, conversation),
      clinicorp: { linked: Boolean(appointment.clinicorpAppointmentId), statusType: remote?.statusType ?? null },
      arrivalAt: iso(origin), bucket: bucketOf(origin, config), scheduled: "other_month", attended: "other_month" };
    evidence.appointments.push(row);
    if (appointment.status === "canceled") { row.scheduled = row.attended = "canceled"; continue; }
    // O tipo explícito vence; sem ele, o nome do serviço conferido nas premissas.
    const kind = parseKind(appointment.kind);
    const typed = Boolean(kind || appointment.serviceType);
    const evaluation = kind ? kind === "evaluation"
      : appointment.serviceType
        ? config.evaluationTypes.some((t) => normalizeLabel(t) === normalizeLabel(appointment.serviceType!))
        : config.countUntypedAsEvaluations;
    if (!typed && !config.countUntypedAsEvaluations) current.untypedAppointments++;
    if (!evaluation) { row.scheduled = row.attended = typed ? "not_evaluation" : "untyped"; continue; }
    if (createdInMonth) {
      addSplit(current.scheduled, origin, config);
      row.scheduled = typed ? "counted" : "counted_untyped";
    }
    if (!startsInMonth) continue;
    if (appointment.startsAt > now) { row.attended = "future"; continue; }
    if (remote?.canceled) { row.attended = "canceled_external"; continue; }
    // Agendado ou confirmado nunca é presença: só "compareceu"/"faltou" marcados.
    const local = attendanceOf(appointment);
    let attended: boolean | null = local === "attended" ? true : local === "no_show" ? false : null;
    if (appointment.clinicorpAppointmentId) {
      // Se há espelho, conferir lá é obrigatório, mesmo com status local antigo.
      // Sem resposta de lá, vale a marcação feita na /agenda (`attendanceAt`); o
      // `done` legado não tem data e continua dependendo do Clinicorp.
      const remoteAnswer = remote?.statusType && config.completedStatusTypes.length
        ? config.completedStatusTypes.includes(remote.statusType) : null;
      attended = remoteAnswer ?? (appointment.attendanceAt ? attended : null);
    }
    if (attended === null) { current.attendanceUnknown++; row.attended = "unknown"; continue; }
    if (!attended) { row.attended = "not_attended"; continue; }
    row.attended = "attended";
    addSplit(current.attended, origin, config);
    if (origin && outsideHumanHours(origin, config) === true) getProcedure(procedureName(appointment, conversation)).attendedOutside++;
  }
  current.procedures = [...procedures].map(([name, value]) => {
    return { name, qualified: value.qualified.size, attendedOutside: value.attendedOutside, revenueCents: null };
  }).sort((a, b) => b.qualified - a.qualified || b.attendedOutside - a.attendedOutside);
  current.time = calculateTimeMetrics({ start, end, conversations: conversations.filter((c) => includesAgent(c.agentId)), appointments, events }, evidence);
  return { metrics: applyMonthlyOverrides(current, {}, config), evidence: capEvidence(evidence) };
}

export async function computeMonthlyReport(tenantId: string, month: string, useSnapshot = true, previewAssumptions?: MonthlyAssumptions): Promise<MonthlyReport> {
  const [tenant, saved] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, createdAt: true, reportTrackingStartedAt: true, planKey: true, priceCentsOverride: true } }),
    prisma.monthlyRoiReport.findUnique({ where: { tenantId_month: { tenantId, month } } }),
  ]);
  if (useSnapshot && !previewAssumptions && saved?.status === "ready" && saved.snapshot) {
    const snapshot = saved.snapshot as unknown as MonthlyReport;
    if (snapshot.version === 1 && snapshot.month === month) return { ...snapshot,
      revision: saved.updatedAt?.toISOString(), status: saved.status, finalizedAt: saved.finalizedAt?.toISOString() ?? null,
      sentAt: saved.sentAt?.toISOString() ?? null, meetingAt: saved.meetingAt?.toISOString() ?? null };
  }
  const inherited = saved ? null : await prisma.monthlyRoiReport.findFirst({
    where: { tenantId, month: { lt: month } }, orderBy: { month: "desc" },
    select: { month: true, assumptions: true },
  });
  const assumptions = { ...(previewAssumptions ?? parseMonthlyAssumptions(saved?.assumptions ?? inherited?.assumptions ?? EMPTY_ASSUMPTIONS)) };
  const accountPrice = monthlyAccountPrice(tenant);
  const investmentSource = assumptions.investmentCents === null ? accountPrice.priceLabel : undefined;
  assumptions.investmentCents ??= accountPrice.priceCents;
  const window = monthlyWindow(month, assumptions.timezone);
  const previousSaved = await prisma.monthlyRoiReport.findUnique({ where: { tenantId_month: { tenantId, month: window.previousMonth } } });
  const reopened = saved?.status === "draft" && saved.snapshot ? saved.snapshot as unknown as MonthlyReport : null;
  const previousBase = reopened?.version === 1 && reopened.month === month && reopened.previousMonth === window.previousMonth ? reopened : null;
  const originalPreviousAssumptions = previousBase?.previousAssumptions ?? parseMonthlyAssumptions(previousSaved?.assumptions ?? EMPTY_ASSUMPTIONS);
  const previousAssumptions = { ...originalPreviousAssumptions, agentIds: assumptions.agentIds };
  const previousWindow = monthlyWindow(window.previousMonth, previousAssumptions.timezone);
  const start = new Date(Math.min(window.start.getTime(), previousWindow.start.getTime()));
  const end = new Date(Math.max(window.end.getTime(), previousWindow.end.getTime()));
  const [rawConversations, appointments, events, clinicorp, gaps, lead] = await Promise.all([
    prisma.conversation.findMany({ where: { tenantId, isTest: false, lead: { isTest: false }, OR: [
      { messages: { some: { createdAt: { gte: start, lt: end } } } },
      { appointments: { some: { OR: [{ startsAt: { gte: start, lt: end } }, { createdAt: { gte: start, lt: end } }] } } },
      { reportEvents: { some: { createdAt: { gte: start, lt: end } } } },
    ] }, select: { id: true, agentId: true, leadId: true, lead: { select: { createdAt: true, status: true, disqualifiedAt: true } }, variables: true,
      messages: { where: { createdAt: { gte: start, lt: end }, role: { in: ["user", "assistant"] } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, role: true, sentBy: true, createdAt: true, audioUrl: true, audioSeconds: true } } } }),
    prisma.appointment.findMany({ where: { tenantId, source: "agent", lead: { isTest: false },
      OR: [{ startsAt: { gte: start, lt: end } }, { createdAt: { gte: start, lt: end } }] },
      select: { id: true, agentId: true, conversationId: true, leadId: true, source: true, serviceType: true, status: true,
        startsAt: true, createdAt: true, clinicorpAppointmentId: true,
        kind: true, procedure: true, attendance: true, attendanceAt: true } }),
    prisma.reportEvent.findMany({ where: { tenantId, createdAt: { gte: start, lt: end }, conversation: { isTest: false, lead: { isTest: false } } },
      select: { id: true, conversationId: true, kind: true, procedure: true, createdAt: true } }),
    readClinicorpReport(tenantId, dayKeyInZone(start, assumptions.timezone), dayKeyInZone(new Date(end.getTime() - 1), assumptions.timezone)),
    prisma.knowledgeGap.findMany({ where: { tenantId, answeredAt: { gte: start, lt: end } },
      select: { id: true, agentId: true, firstAskedAt: true, answeredAt: true } })
      .then((rows) => rows.map((g) => ({ ...g, answeredAt: g.answeredAt! }))),
    // Só o mês do relatório (não o comparativo), no mesmo escopo de agentes. É
    // um complemento: se falhar, o relatório sai sem o bloco em vez de não sair.
    loadLeadQualityDetail(tenantId, { from: window.start, to: window.end }, { agentIds: assumptions.agentIds ?? undefined })
      .catch((error) => { console.error("[monthly] qualidade dos leads indisponível", error); return undefined; }),
  ]);
  const conversationIds = rawConversations.map((c) => c.id);
  const [firstInbound, unheard] = conversationIds.length ? await Promise.all([
    // Uma consulta agregada evita buscar todo o histórico só para descobrir a chegada.
    prisma.message.groupBy({ by: ["conversationId"],
      where: { role: "user", conversation: { tenantId, isTest: false, lead: { isTest: false } }, conversationId: { in: conversationIds } }, _min: { createdAt: true } }),
    // Áudio sem transcrição: a IA não ouviu, então não é tempo que ela assumiu.
    // Consulta à parte para não carregar o texto de todas as mensagens do mês.
    prisma.message.findMany({ where: { role: "user", content: UNTRANSCRIBED_AUDIO, conversationId: { in: conversationIds }, createdAt: { gte: start, lt: end } }, select: { id: true } }),
  ]) : [[], []];
  const firstById = new Map(firstInbound.map((r) => [r.conversationId, r._min.createdAt]));
  const unheardIds = new Set(unheard.map((m) => m.id));
  const conversations = rawConversations.map((c) => ({ ...c, firstInbound: firstById.get(c.id) ?? null,
    messages: c.messages.map(({ audioUrl, audioSeconds, ...m }) => ({ ...m,
      audio: audioUrl || audioSeconds != null || unheardIds.has(m.id) ? { seconds: audioSeconds, heard: !unheardIds.has(m.id) } : null })) }));
  const now = new Date();
  const trackingSince = new Date(Math.max(tenant.createdAt.getTime(), tenant.reportTrackingStartedAt.getTime()));
  const { metrics: automaticCurrent, evidence } = evaluateMonthlyMetrics({ start: window.start, end: window.end, now, trackingSince, accountCreatedAt: tenant.createdAt, config: assumptions, conversations, appointments, events, gaps, clinicorp });
  if (lead) evidence.leads = lead.leads;
  capEvidence(evidence);
  const previousSnapshot = previousSaved?.status === "ready" && previousSaved.snapshot ? previousSaved.snapshot as unknown as MonthlyReport : null;
  const previousAuto = calculateMonthlyMetrics({ start: previousWindow.start, end: previousWindow.end, now, trackingSince, accountCreatedAt: tenant.createdAt, config: previousAssumptions, conversations, appointments, events, gaps, clinicorp });
  const samePreviousScope = sameMonthlyAgentScope(assumptions, originalPreviousAssumptions);
  const automaticPrevious = samePreviousScope && previousBase ? previousBase.previous
    : samePreviousScope && previousSnapshot?.version === 1 ? previousSnapshot.current
    : applyMonthlyOverrides(previousAuto, samePreviousScope ? parseMonthlyOverrides(previousSaved?.assumptions).current : {}, previousAssumptions);
  const metricOverrides = parseMonthlyOverrides(saved?.assumptions);
  const current = applyMonthlyOverrides(automaticCurrent, metricOverrides.current, assumptions);
  // Um comparativo fechado conserva sua base financeira quando não houve correção.
  const previous = Object.keys(metricOverrides.previous).length ? applyMonthlyOverrides(automaticPrevious, metricOverrides.previous, previousAssumptions) : automaticPrevious;
  const agentNames = assumptions.agentIds?.length ? (await prisma.agent.findMany({ where: { tenantId, id: { in: assumptions.agentIds } }, select: { name: true }, orderBy: { name: "asc" } })).map((a) => a.name) : undefined;
  const report: MonthlyReport = { version: 1, tenantName: tenant.name, month, label: new Intl.DateTimeFormat("pt-BR", { timeZone: assumptions.timezone, month: "long", year: "numeric" }).format(window.start),
    previousMonth: window.previousMonth, generatedAt: now.toISOString(), dueAt: window.dueAt.toISOString(), partial: now < window.end,
    assumptions, investmentSource, agentNames, ...(inherited ? { assumptionsFromMonth: inherited.month } : {}), revision: saved?.updatedAt?.toISOString(), metricOverrides,
    automatic: { current: automaticCurrent, previous: automaticPrevious }, previousAssumptions, previousConfigured: previousBase?.previousConfigured ?? Boolean(previousSaved), current, previous,
    clinicorpError: clinicorp.error, clinicorpStatusTypes: clinicorp.statusTypes, clinicorpIntegrationState: clinicorp.integrationState,
    adjustments: saved?.adjustments ?? "", nextMonth: saved?.nextMonth ?? "", decisionMaker: saved?.decisionMaker ?? "",
    featuredCase: saved?.featuredCase ?? "",
    highlights: saved?.highlights ?? "", limitationsNote: saved?.limitationsNote ?? "", nextActions: parseNextActions(saved?.nextActions),
    ...(lead ? { leadQuality: lead.quality } : {}),
    evidence,
    status: saved?.status ?? "draft", finalizedAt: saved?.finalizedAt?.toISOString() ?? null,
    sentAt: saved?.sentAt?.toISOString() ?? null, meetingAt: saved?.meetingAt?.toISOString() ?? null };
  // Calculado aqui, com as correções já aplicadas, para o snapshot congelar o
  // selo junto com o número: o PDF e o painel leem o mesmo.
  report.quality = monthlyQuality(report);
  // Mesma regra, mesmo momento: o fechamento congela a lista que o admin confirmou.
  report.limitations = monthlyLimitations(report);
  return report;
}

export type MonthlyCaseCandidate = { conversationId: string; firstAt: string; audios: number[] };

/**
 * Sugestões para o caso do mês (só no admin, nunca no snapshot nem no PDF):
 * conversas em que o agente ouviu áudios longos. A Mavellium abre a conversa,
 * confere o que aconteceu e escreve o caso só com o perfil genérico.
 */
export async function loadMonthlyCaseCandidates(tenantId: string, month: string, config: MonthlyAssumptions): Promise<MonthlyCaseCandidate[]> {
  const window = monthlyWindow(month, config.timezone);
  const rows = await prisma.message.findMany({
    where: { role: "user", audioSeconds: { gt: LONG_AUDIO_SECONDS }, content: { not: UNTRANSCRIBED_AUDIO },
      createdAt: { gte: window.start, lt: window.end },
      conversation: { tenantId, isTest: false, lead: { isTest: false }, ...(config.agentIds?.length ? { agentId: { in: config.agentIds } } : {}) } },
    select: { conversationId: true, audioSeconds: true, createdAt: true }, orderBy: { audioSeconds: "desc" }, take: 200,
  });
  const byConversation = new Map<string, { first: Date; audios: { at: Date; seconds: number }[] }>();
  for (const row of rows) {
    const entry = byConversation.get(row.conversationId) ?? { first: row.createdAt, audios: [] };
    entry.audios.push({ at: row.createdAt, seconds: row.audioSeconds! });
    if (row.createdAt < entry.first) entry.first = row.createdAt;
    byConversation.set(row.conversationId, entry);
  }
  const longest = (audios: { seconds: number }[]) => Math.max(...audios.map((a) => a.seconds));
  return [...byConversation].sort(([, a], [, b]) => longest(b.audios) - longest(a.audios) || b.audios.length - a.audios.length)
    .slice(0, 5).map(([conversationId, entry]) => ({ conversationId, firstAt: entry.first.toISOString(),
      audios: entry.audios.sort((a, b) => a.at.getTime() - b.at.getTime()).map((a) => a.seconds) }));
}
