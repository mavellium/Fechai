/** Exige DDI explícito para não transformar número estrangeiro em brasileiro. */
export function normalizeBroadcastPhone(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  if (!/^\+?[\d\s().-]+$/.test(text)) return null;
  const digits = text.replace(/\D/g, "");
  if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
  if (
    digits.startsWith("55") &&
    !/^55[1-9]\d(?:[2-9]\d{7}|9\d{8})$/.test(digits)
  )
    return null;
  return digits;
}

/** O mesmo celular brasileiro pode chegar do WhatsApp com ou sem o nono dígito. */
export function broadcastPhoneVariants(phone: string): string[] {
  if (/^55\d{2}9\d{8}$/.test(phone))
    return [phone, phone.slice(0, 4) + phone.slice(5)];
  if (/^55\d{2}[6-9]\d{7}$/.test(phone))
    return [phone, phone.slice(0, 4) + "9" + phone.slice(4)];
  return [phone];
}
