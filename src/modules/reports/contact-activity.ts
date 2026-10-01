/** A contact enters the attended cohort only after inbound + a attributed reply. */
export type ActivityMessage = { role: string; sentBy: string | null; createdAt: Date };

export function contactActivity<T extends ActivityMessage>(input: readonly T[]) {
  const messages = [...input].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const first = messages.find((m) => m.role === "user");
  const replies = first ? messages.filter((m) => m.role === "assistant"
    && (m.sentBy === "agent" || m.sentBy === "human") && m.createdAt >= first.createdAt) : [];
  return { first, replies, messages };
}

export function contactWasTransferred(replies: readonly ActivityMessage[], handoffs: number) {
  return handoffs > 0 || replies.some((m) => m.sentBy === "human");
}

export function periodContactActivity(messages: readonly (ActivityMessage & { conversationId: string })[], handoffIds: readonly string[] = []) {
  const grouped = new Map<string, typeof messages[number][]>();
  for (const m of messages) {
    const group = grouped.get(m.conversationId) ?? [];
    group.push(m);
    grouped.set(m.conversationId, group);
  }
  const contacts = new Map<string, ReturnType<typeof contactActivity>>();
  const handoffs = new Set(handoffIds);
  const active = new Set<string>(), attended = new Set<string>(), aiOnly = new Set<string>(), human = new Set<string>(), transferred = new Set<string>();
  for (const [id, group] of grouped) {
    const contact = contactActivity(group);
    const { first, replies } = contact;
    if (!first) continue;
    active.add(id);
    if (!replies.length) continue;
    attended.add(id);
    contacts.set(id, contact);
    if (replies.some((m) => m.sentBy === "human")) human.add(id);
    if (contactWasTransferred(replies, handoffs.has(id) ? 1 : 0)) transferred.add(id);
    else aiOnly.add(id);
  }
  return { active, attended, aiOnly, human, transferred, contacts, responseRate: active.size ? attended.size / active.size : 0 };
}
