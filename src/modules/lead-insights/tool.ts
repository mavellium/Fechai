import type { LlmToolSchema } from "@/modules/ai";
import { DOUBT_CATEGORIES, LOSS_CATEGORIES } from "./categories";
import type { RecordInsightResult } from "./record";

/**
 * Tool interna `record_lead_insight` e a regra que a acompanha no prompt.
 * Como `report_unanswered` e `remember_variables`, não ocupa vaga de habilidade
 * do plano: vale para todo agente. Não custa chamada extra de IA — o modelo
 * registra durante o turno que já ia responder.
 */

export const LEAD_INSIGHT_TOOL = "record_lead_insight";

const list = (items: { key: string; hint: string }[]) => items.map((c) => `${c.key}: ${c.hint}`).join(" | ");

export const leadInsightToolSchema: LlmToolSchema = {
  name: LEAD_INSIGHT_TOOL,
  description:
    "Registra, para o relatório de qualidade dos leads da clínica, o que o contato DISSE: a cidade onde mora, o procedimento que quer, a primeira dúvida real e o motivo de não seguir. " +
    "Chame assim que a informação aparecer (pode chamar de novo quando surgir um dado novo). Envie só os campos que o contato informou, com as palavras dele; nunca deduza cidade por DDD, nome ou sotaque. " +
    "É um registro interno: não pergunte apenas para preenchê-lo, não mencione que registrou e continue a conversa normalmente.",
  parameters: {
    type: "object",
    properties: {
      city: { type: "string", description: "Cidade onde o contato mora ou onde quer ser atendido, só o nome (ex.: 'Marília'). Somente se ele disse." },
      procedure: { type: "string", description: "Procedimento ou tratamento que o contato disse querer (ex.: 'implante'). Somente se ele disse." },
      first_question_category: {
        type: "string",
        enum: DOUBT_CATEGORIES.map((c) => c.key),
        description:
          "Categoria da PRIMEIRA dúvida real do contato, ignorando a saudação e a mensagem pronta do anúncio (ex.: 'Olá, quero mais informações'). Registre uma vez; as seguintes são ignoradas. " +
          list(DOUBT_CATEGORIES),
      },
      first_question_text: { type: "string", description: "Essa dúvida em uma frase curta e geral, sem nome, telefone nem outro dado pessoal." },
      loss_reason_category: {
        type: "string",
        enum: LOSS_CATEGORIES.map((c) => c.key),
        description: "Somente quando o contato disser por que não vai seguir ou agendar. " + list(LOSS_CATEGORIES),
      },
      loss_reason_text: { type: "string", description: "O motivo em uma frase curta, sem dado pessoal (ex.: 'queria em Marília')." },
    },
  },
};

/** Regra curta em todo turno com agente: sem ela o modelo só chama a tool quando o texto da descrição o convence. */
export function leadInsightRule(): string {
  return (
    "<regra_registro_do_lead>\n" +
    `Quando o contato disser a cidade onde mora, o procedimento que quer, a primeira dúvida real (depois da saudação ou da mensagem pronta do anúncio) ou por que não vai seguir, chame ${LEAD_INSIGHT_TOOL} com exatamente o que ele disse. ` +
    "Não deduza, não pergunte só para preencher o registro e não comente com o contato que registrou.\n" +
    "</regra_registro_do_lead>"
  );
}

/** O que o LLM lê depois de registrar: nunca instrui a mudar a conversa. */
export function leadInsightToolResult(result: RecordInsightResult): string {
  switch (result.status) {
    case "saved": return "Registrado. Continue a conversa normalmente, sem mencionar o registro.";
    case "test": return "Conversa de teste: este registro não entra nos números da clínica. Continue normalmente.";
    case "empty": return "Nada para registrar: envie só o que o contato realmente informou. Continue a conversa normalmente.";
    default: return "Não foi possível registrar agora. Continue a conversa normalmente.";
  }
}
