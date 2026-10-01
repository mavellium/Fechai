import { contactActivity, type ActivityMessage } from "./contact-activity";

export const CONTACT_CONTEXT_LABEL = {
  inbound_new: "Novos contatos que iniciaram a conversa",
  inbound_existing: "Contatos da base que voltaram a escrever",
  outbound_human: "Abordagens iniciadas pela equipe",
  outbound_agent: "Abordagens iniciadas pelo agente",
  outbound_campaign: "Abordagens de campanha",
  outbound_followup: "Retomadas automáticas",
  outbound_reminder: "Lembretes de consultas",
  continued: "Atendimentos em continuidade do período anterior",
  unknown: "Contexto não identificado",
} as const;
export type ContactContext = keyof typeof CONTACT_CONTEXT_LABEL;
export type ContextMessage = ActivityMessage & { id?: string; contactCreatedAt?: Date; beforeWindow?: ActivityMessage & { id?: string } };
export type ContextContact = { id: string; messages: readonly ContextMessage[]; firstMessage?: ContextMessage | null };
export type ContextEvent = { kind: string; conversationId: string; messageId?: string; createdAt: Date };
export type ContextBooking = { id: string; conversationId: string | null; createdAt: Date };
export type ContactContextEvidence = {
  conversationId: string; context: ContactContext; firstAt: string; firstMessageId: string | null;
  lifetimeInitiator: "contact" | "human" | "agent" | "unknown";
  attended: boolean; booked: boolean; appointmentIds: string[];
};
export type ContactContextSummary = {
  active: number; attended: number; attributedEvaluations: number; unattributedEvaluations: number;
  /** Inbound does not prove paid traffic; an old contact does not prove a qualified clinic list. */
  acquisition: "not_recorded";
  groups: { key: ContactContext; label: string; contacts: number; attended: number; scheduledContacts: number;
    evaluations: number; conversionPercent: number | null }[];
};

/** Same pass as all other metrics. No text classification or assumed acquisition channel. */
export function summarizeContactContexts(input: {
  start: Date | null; end: Date; conversations: readonly ContextContact[]; bookings: readonly ContextBooking[]; events?: readonly ContextEvent[];
}): { summary: ContactContextSummary; records: ContactContextEvidence[] } {
  const inside = (at: Date) => (!input.start || at >= input.start) && at < input.end;
  const eventByMessage = new Map((input.events ?? []).filter((e) => e.messageId && e.createdAt < input.end)
    .map((e) => [`${e.conversationId}:${e.messageId}`, e.kind]));
  const records: ContactContextEvidence[] = [];
  const arrivals = new Map<string, Date>();
  for (const c of input.conversations) {
    const activity = contactActivity(c.messages.filter((m) => inside(m.createdAt)));
    const first = activity.messages[0];
    if (!first) continue;
    const lifetime = c.firstMessage;
    const lifetimeInitiator = lifetime?.role === "user" ? "contact" : lifetime?.sentBy === "human" ? "human"
      : lifetime?.sentBy === "agent" ? "agent" : "unknown";
    let context: ContactContext = "unknown";
    const preceding = lifetime?.beforeWindow;
    const continued = preceding && first.createdAt >= preceding.createdAt && +first.createdAt - +preceding.createdAt <= 24 * 3600_000;
    const purpose = first.role === "assistant" && first.id ? eventByMessage.get(`${c.id}:${first.id}`) : undefined;
    if (purpose === "contact_reminder") context = "outbound_reminder";
    else if (purpose === "contact_campaign") context = "outbound_campaign";
    else if (purpose === "contact_followup") context = "outbound_followup";
    else if (continued) context = "continued";
    else if (first.role === "user" && lifetime && lifetime.createdAt <= first.createdAt) {
      context = lifetime.role === "user" && inside(lifetime.createdAt)
        && (!lifetime.contactCreatedAt || inside(lifetime.contactCreatedAt)) ? "inbound_new" : "inbound_existing";
    } else if (first.role === "assistant") {
      context = first.sentBy === "human" ? "outbound_human" : first.sentBy === "agent" ? "outbound_agent" : "unknown";
    }
    if (activity.first) arrivals.set(c.id, activity.first.createdAt);
    records.push({ conversationId: c.id, context, firstAt: first.createdAt.toISOString(), firstMessageId: first.id ?? null,
      lifetimeInitiator, attended: activity.replies.length > 0, booked: false, appointmentIds: [] });
  }
  const byId = new Map(records.map((record) => [record.conversationId, record]));
  let unattributedEvaluations = 0;
  for (const booking of input.bookings) {
    if (!inside(booking.createdAt)) continue;
    const row = booking.conversationId ? byId.get(booking.conversationId) : undefined;
    const arrival = booking.conversationId ? arrivals.get(booking.conversationId) : undefined;
    // Booking before the contact's inbound is not conversion of that inbound.
    if (!row || !arrival || booking.createdAt < arrival) { unattributedEvaluations++; continue; }
    row.booked = true;
    row.appointmentIds.push(booking.id);
  }
  const groups = (Object.keys(CONTACT_CONTEXT_LABEL) as ContactContext[]).map((key) => {
    const rows = records.filter((r) => r.context === key);
    const scheduledContacts = rows.filter((r) => r.booked).length;
    return { key, label: CONTACT_CONTEXT_LABEL[key], contacts: rows.length, attended: rows.filter((r) => r.attended).length,
      scheduledContacts, evaluations: rows.reduce((n, r) => n + r.appointmentIds.length, 0),
      conversionPercent: rows.length && key !== "unknown" ? Math.round(scheduledContacts / rows.length * 1000) / 10 : null };
  });
  return { summary: { active: records.length, attended: records.filter((r) => r.attended).length,
    attributedEvaluations: groups.reduce((n, g) => n + g.evaluations, 0), unattributedEvaluations, acquisition: "not_recorded", groups }, records };
}
