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
  /** "Evidências consultadas": o que as ferramentas leram, anotado pelo servidor. */
  consulted: z.array(z.object({ tool: z.string().max(40), label: z.string().max(200), count: z.number().int().min(0) }).strict()).max(40).optional(),
  /** Lista de conferência proposta; o conteúdo só aparece depois da confirmação. */
  review: z.object({ title: z.string().max(120), question: z.string().max(240),
    rows: z.array(z.object({ appointmentId: z.string().max(100), conversationId: z.string().max(100).nullable(), when: z.string().max(120), issues: z.array(z.string().max(200)).max(5) }).strict()).max(100) }).strict().optional(),
});
export type MonthlyAiChatMessage = z.infer<typeof monthlyAiChatMessageSchema>;

/** Nunca lança: a linha pode estar vazia, antiga ou com sugestões que o contrato já não aceita. */
export function parseMonthlyAiChat(raw: unknown): MonthlyAiChatMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const parsed = monthlyAiChatMessageSchema.safeParse(item);
    if (parsed.success) return [parsed.data];
    // Sugestão fora do contrato atual: mantém o texto e descarta só os extras.
    const text = monthlyAiChatMessageSchema.omit({ changes: true, consulted: true, review: true }).safeParse(item);
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
