import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { cleanQuestion } from "@/modules/knowledge-gaps/text";
import { parseDoubtCategory, parseLossCategory } from "./categories";
import { cleanCity, normalizeCity } from "./city";

/**
 * Registro do que o agente entendeu da conversa (tool `record_lead_insight`).
 * Só entra o que o contato DISSE — cidade, procedimento, primeira dúvida real,
 * motivo de perda. Nunca lança: relatório não derruba atendimento (mesma regra
 * de `recordReportEvent` e `registerKnowledgeGap`).
 */

export type RecordInsightInput = {
  tenantId: string;
  conversationId: string;
  /** Valores crus vindos do LLM: cada um é validado aqui. */
  city?: unknown;
  procedure?: unknown;
  firstQuestionCategory?: unknown;
  firstQuestionText?: unknown;
  lossReasonCategory?: unknown;
  lossReasonText?: unknown;
};

/** `saved`: gravou algo · `empty`: nada válido veio · `test`: conversa de teste, fora dos números · `failed`: erro ou conversa não encontrada. */
export type RecordInsightResult = { status: "saved" | "empty" | "test" | "failed"; fields: string[] };

const MAX_TEXT = 200;

/** Uma linha curta e sem contato: e-mail e sequências de telefone saem, o agente não deve mandá-los. */
export function scrubInsightText(raw: unknown): string | null {
  const line = cleanQuestion(raw)
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "")
    .replace(/\+?\(?\d[\d\s().-]{7,}\d/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!line) return null;
  return line.length > MAX_TEXT ? `${line.slice(0, MAX_TEXT - 1).trimEnd()}…` : line;
}

function cleanProcedure(raw: unknown): string | null {
  const text = scrubInsightText(raw);
  return text ? text.slice(0, 100) : null;
}

export async function recordLeadInsight(input: RecordInsightInput): Promise<RecordInsightResult> {
  try {
    const city = cleanCity(input.city);
    const cityKey = normalizeCity(input.city);
    const procedure = cleanProcedure(input.procedure);
    const doubtText = scrubInsightText(input.firstQuestionText);
    // Texto sem categoria é uma dúvida que o modelo não soube classificar.
    const doubtKey = parseDoubtCategory(input.firstQuestionCategory) ?? (doubtText ? "outro" : null);
    const lossText = scrubInsightText(input.lossReasonText);
    const lossKey = parseLossCategory(input.lossReasonCategory) ?? (lossText ? "outro" : null);

    const latest = {
      ...(city && cityKey ? { city, cityKey } : {}),
      ...(procedure ? { procedure } : {}),
      ...(lossKey ? { lossReasonKey: lossKey, lossReasonText: lossText } : {}),
    };
    const first = doubtKey ? { firstQuestionKey: doubtKey, firstQuestionText: doubtText } : null;
    const fields = [
      ...(city && cityKey ? ["city"] : []),
      ...(procedure ? ["procedure"] : []),
      ...(first ? ["firstQuestion"] : []),
      ...(lossKey ? ["lossReason"] : []),
    ];
    if (!fields.length) return { status: "empty", fields: [] };

    // O tenant no filtro: o id da conversa vem do contexto do turno, mas escrever
    // por id cru é o caminho em que um id trocado atravessa conta sem ninguém ver.
    const conversation = await prisma.conversation.findFirst({
      where: { id: input.conversationId, tenantId: input.tenantId },
      select: { id: true, isTest: true, lead: { select: { isTest: true } } },
    });
    if (!conversation) return { status: "failed", fields: [] };
    if (conversation.isTest || conversation.lead.isTest) return { status: "test", fields };

    const write = () => prisma.conversationInsight.upsert({
      where: { conversationId: conversation.id },
      create: { tenantId: input.tenantId, conversationId: conversation.id, ...latest, ...(first ?? {}) },
      update: latest,
    });
    try {
      await write();
    } catch (error) {
      // Dois registros da mesma conversa ao mesmo tempo: o segundo cai no update.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      await write();
    }
    // A primeira dúvida é gravada uma vez: só preenche se ainda estiver vazia.
    if (first) {
      await prisma.conversationInsight.updateMany({
        where: { conversationId: conversation.id, tenantId: input.tenantId, firstQuestionKey: null },
        data: first,
      });
    }
    return { status: "saved", fields };
  } catch (error) {
    console.error("[lead-insights] registro não gravado", error);
    return { status: "failed", fields: [] };
  }
}
