import { prisma } from "@/lib/prisma";
import { isAiError, type LlmMessage } from "@/modules/ai";
import { getUsageSummary } from "@/modules/billing/usage";
import { INJECTION_GUARD } from "@/modules/agent-engine/injection-guard";
import { sanitizeUnresolvedPlaceholders } from "@/modules/agent-engine/reply-sanitizer";
import { completeBackgroundText } from "@/modules/agent-engine/summary";
import { MAX_FOLLOWUP_MESSAGE_LENGTH } from "./config";

/**
 * Follow-up escrito pela IA (etapa com `ai: true`).
 *
 * A etapa guarda uma mensagem de referência; aqui a IA a reescreve retomando o
 * último assunto do contato, na voz da persona do agente. "Ficou alguma
 * dúvida?" genérico é o que todo mundo ignora — "conseguiu ver os horários de
 * quinta para a limpeza?" é o que traz a pessoa de volta.
 *
 * **Conta na cota do plano** (`sentBy: "agent"`, ver `modules/billing/usage.ts`):
 * é resposta gerada pelo LLM, como a do atendimento. Por isso a cota é checada
 * ANTES da chamada paga, e sem cota a referência sai como está — o follow-up
 * não pode morrer porque a IA ficou sem saldo.
 *
 * Nunca lança: IA fora do ar, resposta vazia ou cota estourada caem na
 * referência. É trabalho de segundo plano, e uma falha aqui não pode travar a
 * varredura das outras conversas.
 */

/** Mensagens da conversa que vão para o modelo: as mais recentes bastam. */
const MAX_MESSAGES_IN_PROMPT = 20;

const TASK = `TAREFA: o contato parou de responder e você vai mandar UMA mensagem de follow-up pelo WhatsApp.

Reescreva a mensagem de referência abaixo para retomar o último assunto da conversa, no mesmo tom da sua persona.

Regras:
- No máximo duas frases curtas.
- Não invente preço, horário, promoção ou qualquer fato que não esteja na conversa.
- Não diga que é mensagem automática e não peça desculpas por insistir.
- Não use "bom dia", "boa tarde" ou "boa noite": a mensagem pode sair em qualquer hora.
- Responda só com o texto da mensagem, sem aspas e sem explicação.`;

export type ComposedFollowUp = {
  text: string;
  /** Saiu da IA — grava `sentBy: "agent"` e conta na cota. */
  byAi: boolean;
};

export async function composeFollowUp(input: {
  tenantId: string;
  conversationId: string;
  systemPrompt: string | null;
  /** A mensagem da etapa, já com as variáveis substituídas. */
  reference: string;
  /** Valores da conversa, para limpar variável que a IA copiar crua. */
  values: Record<string, string>;
}): Promise<ComposedFollowUp> {
  const fallback: ComposedFollowUp = { text: input.reference, byAi: false };

  try {
    const usage = await getUsageSummary(input.tenantId);
    if (usage.atLimit) return fallback;

    // As mais recentes, mas em ordem cronológica — mesmo cuidado do resumo.
    const recent = await prisma.message.findMany({
      where: { conversationId: input.conversationId, role: { in: ["user", "assistant"] } },
      orderBy: { createdAt: "desc" },
      take: MAX_MESSAGES_IN_PROMPT,
      select: { role: true, content: true },
    });
    const transcript = recent
      .reverse()
      .map((m) => `${m.role === "user" ? "Contato" : "Você"}: ${m.content}`)
      .join("\n");

    // A conversa vai como UMA mensagem de usuário, não como histórico: o
    // último turno é do agente (é por isso que há follow-up), e terminar a
    // lista em "assistant" não é aceito por todo provedor da cadeia.
    const messages: LlmMessage[] = [
      {
        role: "system",
        content: [input.systemPrompt?.trim() ?? "", TASK, INJECTION_GUARD].filter(Boolean).join("\n\n"),
      },
      {
        role: "user",
        content: `Conversa até agora:\n\n${transcript}\n\nMensagem de referência:\n${input.reference}`,
      },
    ];

    const raw = await completeBackgroundText(messages);
    const text = sanitizeUnresolvedPlaceholders(stripQuotes(raw), input.values)
      .slice(0, MAX_FOLLOWUP_MESSAGE_LENGTH)
      .trim();
    return text ? { text, byAi: true } : fallback;
  } catch (err) {
    if (!isAiError(err)) console.error("[follow-up] falha ao compor pela IA", input.conversationId, err);
    return fallback;
  }
}

/** Modelos às vezes devolvem a frase entre aspas, mesmo pedindo que não. */
function stripQuotes(text: string): string {
  const t = text.trim();
  const pairs: Array<[string, string]> = [['"', '"'], ["“", "”"], ["'", "'"]];
  for (const [open, close] of pairs) {
    if (t.length > 1 && t.startsWith(open) && t.endsWith(close)) return t.slice(1, -1).trim();
  }
  return t;
}
