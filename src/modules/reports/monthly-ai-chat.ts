import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { monthlyAiResponseSchema } from "./monthly-ai";

/** Teto do histórico guardado por competência; as mais antigas saem primeiro. */
export const MONTHLY_AI_CHAT_LIMIT = 100;

export const monthlyAiChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(5000),
  at: z.string(),
  provider: z.string().max(120).optional(),
  changes: monthlyAiResponseSchema.shape.changes.optional(),
});
export type MonthlyAiChatMessage = z.infer<typeof monthlyAiChatMessageSchema>;

/** Nunca lança: a linha pode estar vazia, antiga ou com sugestões que o contrato já não aceita. */
export function parseMonthlyAiChat(raw: unknown): MonthlyAiChatMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const parsed = monthlyAiChatMessageSchema.safeParse(item);
    if (parsed.success) return [parsed.data];
    // Sugestão fora do contrato atual: mantém o texto e descarta só os campos.
    const text = monthlyAiChatMessageSchema.omit({ changes: true }).safeParse(item);
    return text.success ? [text.data] : [];
  });
}

export async function loadMonthlyAiChat(tenantId: string, month: string): Promise<MonthlyAiChatMessage[]> {
  const row = await prisma.monthlyRoiAiChat.findUnique({ where: { tenantId_month: { tenantId, month } }, select: { messages: true } });
  return parseMonthlyAiChat(row?.messages);
}

export async function appendMonthlyAiChat(tenantId: string, month: string, userId: string, added: MonthlyAiChatMessage[]) {
  const messages = [...await loadMonthlyAiChat(tenantId, month), ...added].slice(-MONTHLY_AI_CHAT_LIMIT) as Prisma.InputJsonValue;
  await prisma.monthlyRoiAiChat.upsert({
    where: { tenantId_month: { tenantId, month } },
    create: { tenantId, month, messages, updatedBy: userId },
    update: { messages, updatedBy: userId },
  });
}

export async function clearMonthlyAiChat(tenantId: string, month: string) {
  await prisma.monthlyRoiAiChat.deleteMany({ where: { tenantId, month } });
}
