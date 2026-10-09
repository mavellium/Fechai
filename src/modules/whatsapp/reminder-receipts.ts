const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const statuses: Record<string, string> = { "0": "failed", "2": "sent", "3": "delivered", "4": "read", "5": "read", ERROR: "failed", SERVER_ACK: "sent", DELIVERY_ACK: "delivered", READ: "read", READ_ACK: "read", PLAYED: "read" };
export function parseEvolutionReminderReceipts(payload: unknown) {
  const p = object(payload);
  if (String(p.event).toLowerCase().replaceAll("_", ".") !== "messages.update" || typeof p.instance !== "string") return [];
  const rows = Array.isArray(p.data) ? p.data : [p.data];
  return rows.flatMap((raw) => {
    const row = object(raw), key = object(row.key), update = object(row.update);
    const messageId = key.id ?? row.keyId;
    const status = statuses[String(update.status ?? row.status).toUpperCase()];
    if (key.fromMe === false || typeof messageId !== "string" || !messageId || !status) return [];
    return [{ instanceExternalId: p.instance as string, messageId, status }];
  });
}
