/**
 * Contratos da camada de IA.
 *
 * A regra: nada fora de `src/modules/ai/providers/` importa SDK de provedor.
 * O resto do sistema fala só com `LLMProvider` — trocar Gemini por OpenAI,
 * Claude ou um modelo self-hosted é escrever um novo adapter e registrá-lo.
 */

export type LlmMessage =
  | { role: "system" | "user" | "assistant"; content: string }
  | { role: "assistant"; content: string; toolCalls: LlmToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export type LlmToolCall = { id: string; name: string; arguments: Record<string, unknown> };

export type LlmToolSchema = {
  name: string;
  description: string;
  /** JSON Schema (subconjunto OpenAPI) dos argumentos. */
  parameters: Record<string, unknown>;
};

/**
 * Consumo de tokens de uma chamada, quando o provedor devolve. `undefined`
 * (não zerado) quando não deu para capturar — ex.: resposta de demonstração
 * sem chave configurada, ou falha ao extrair `usage` da resposta. Nunca deixar
 * essa captura derrubar a chamada real (ver `OpenAICompatProvider.complete`).
 */
export type LlmUsage = { promptTokens: number; completionTokens: number; totalTokens: number };

export type LlmResult = { content: string; toolCalls: LlmToolCall[]; usage?: LlmUsage };

export interface LLMProvider {
  /** Chave do provedor no catálogo (ex.: "gemini"). */
  readonly provider: ProviderKey;
  /** Modelo efetivamente usado nas chamadas. */
  readonly model: string;
  /** Há credencial configurada neste ambiente? */
  isConfigured(): boolean;
  complete(messages: LlmMessage[], tools: LlmToolSchema[]): Promise<LlmResult>;
}

export type ProviderKey = "gemini" | "openai" | "grok" | "groq";

/* ------------------------------------------------------------------ *
 * Erros — o orquestrador distingue "acabou a cota" de "deu ruim".
 * ------------------------------------------------------------------ */

export type AiErrorCode = "rate_limit" | "quota_exceeded" | "auth" | "provider";

export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
    readonly options: { provider: ProviderKey; model: string; retryAfterSeconds?: number } & {
      cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = "AiError";
  }

  /** Mensagem segura para mostrar ao usuário final (PT-BR, sem detalhe técnico). */
  get userMessage(): string {
    switch (this.code) {
      case "rate_limit":
        return "Estamos recebendo muitas mensagens agora. Tento de novo em instantes.";
      case "quota_exceeded":
        return "O provedor de IA atingiu o limite diário de uso da API. Um humano vai assumir daqui.";
      case "auth":
        return "A integração de IA está sem credencial válida. Avise o administrador.";
      default:
        return "Tive um problema para responder agora. Já avisei a equipe.";
    }
  }
}

export function isAiError(e: unknown): e is AiError {
  return e instanceof AiError;
}
