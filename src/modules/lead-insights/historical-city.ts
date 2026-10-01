import municipalities from "./municipalities.json";
import { normalizeCity } from "./city";

/** IBGE localidades/municipios, downloaded 2026-10-01. Exact names only. */
const cities = new Map(municipalities.map((city) => [normalizeCity(city)!, city]));
type Message = { id: string; role: string; content: string; createdAt: Date };
export type CityDeclaration = { city: string; cityKey: string; messageId: string; declaredAt: Date };

/** Literal self-location or a city-only answer to a direct city question. No fuzzy match. */
export function declaredCity(message: Message, previous?: Pick<Message, "role" | "content">): CityDeclaration | null {
  if (message.role !== "user") return null;
  const text = message.content.trim();
  // Split at punctuation: never strip numbers, addresses, names or negations into a city.
  const literal = text.match(/^(?:eu\s+)?(?:sou\s+(?:da\s+cidade\s+de|de)|moro\s+(?:na\s+cidade\s+de|em)|resido\s+em|minha\s+cidade\s+[ée])\s+([^,.!?;\n]+)(?:[,.;!?]|$)/iu)?.[1];
  const question = previous?.role === "assistant" && /(?:qual|que)\s+(?:[ée]\s+)?(?:a\s+)?sua\s+cidade|(?:qual|que)\s+cidade\s+(?:voc[eê]|vc)\s+(?:[ée]|mora|reside)|(?:voc[eê]|vc)\s+[ée]\s+de\s+(?:qual|que)\s+cidade|(?:onde|aonde)\s+(?:voc[eê]|vc)\s+(?:mora|reside)|de\s+onde\s+(?:voc[eê]|vc)\s+[ée]|(?:voc[eê]|vc)\s+[ée]\s+de\s+onde/iu.test(previous.content);
  const candidate = literal ?? (question ? text.replace(/[.!]$/, "") : null);
  if (!candidate) return null;
  const key = normalizeCity(candidate);
  const city = key ? cities.get(key) : undefined;
  return city && key ? { city, cityKey: key, messageId: message.id, declaredAt: message.createdAt } : null;
}
