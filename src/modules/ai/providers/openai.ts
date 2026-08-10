import OpenAI, { APIError } from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import {
  AiError,
  type LLMProvider,
  type LlmMessage,
  type LlmResult,
  type LlmToolCall,
  type LlmToolSchema,
  type ProviderKey,
} from "../types";

/**
 * Base para provedores com API compatível com a OpenAI (OpenAI, xAI/Grok, ...).
 * Todo acoplamento com o SDK mora aqui; o subadapter só informa quem é, onde
 * fica a chave e o baseURL.
 */
export type OpenAICompatConfig = {
  provider: ProviderKey;
  envKey: string;
  /** URL base da API. Omitido = API oficial da OpenAI. */
  baseURL?: string;
  /** Nome para mensagens de erro (ex.: "OpenAI", "xAI"). */
  displayName: string;
};

export class OpenAICompatProvider implements LLMProvider {
  readonly provider: ProviderKey;
  readonly model: string;
  private client: OpenAI | null = null;

  constructor(model: string, private readonly config: OpenAICompatConfig) {
    this.model = model;
    this.provider = config.provider;
  }

  isConfigured() {
    return Boolean(process.env[this.config.envKey]);
  }

  private getClient() {
    this.client ??= new OpenAI({
      apiKey: process.env[this.config.envKey],
      baseURL: this.config.baseURL,
    });
    return this.client;
  }

  async complete(messages: LlmMessage[], tools: LlmToolSchema[]): Promise<LlmResult> {
    if (!this.isConfigured()) {
      return {
        content: `Recebi sua mensagem! (IA em modo de demonstração — configure ${this.config.envKey} para respostas reais.)`,
        toolCalls: [],
      };
    }

    const openaiTools: ChatCompletionTool[] = tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));

    try {
      const res = await this.getClient().chat.completions.create({
        model: this.model,
        messages: messages.map(toOpenAIMessage),
        tools: openaiTools.length ? openaiTools : undefined,
      });

      const msg = res.choices[0]?.message;
      const toolCalls: LlmToolCall[] = (msg?.tool_calls ?? [])
        .filter((c) => c.type === "function")
        .map((c) => ({
          id: c.id,
          name: c.function.name,
          arguments: safeParse(c.function.arguments),
        }));

      return { content: msg?.content ?? "", toolCalls };
    } catch (err) {
      throw this.toAiError(err);
    }
  }

  private toAiError(err: unknown): AiError {
    const name = this.config.displayName;
    const ctx = { provider: this.provider, model: this.model, cause: err } as const;
    if (err instanceof APIError) {
      if (err.status === 429) {
        // 429 tanto para rate limit quanto para crédito acabado.
        const outOfCredit = /quota|billing|insufficient/i.test(err.message);
        return new AiError(
          outOfCredit ? "quota_exceeded" : "rate_limit",
          `${name}: ${err.message}`,
          ctx,
        );
      }
      if (err.status === 401 || err.status === 403) {
        // xAI/OpenAI respondem 403 quando a conta ficou sem crédito ou bateu o
        // limite de gasto — não é erro de credencial, é cota esgotada.
        const outOfCredit = /quota|billing|insufficient|credit|spending|limit/i.test(err.message);
        if (outOfCredit) {
          return new AiError("quota_exceeded", `${name}: ${err.message}`, ctx);
        }
        return new AiError("auth", `${name} credencial inválida: ${err.message}`, ctx);
      }
      return new AiError("provider", `${name} erro ${err.status}: ${err.message}`, ctx);
    }
    return new AiError("provider", `${name} falhou: ${String(err)}`, ctx);
  }
}

/** Adapter da OpenAI. */
export class OpenAIProvider extends OpenAICompatProvider {
  constructor(model: string) {
    super(model, { provider: "openai", envKey: "OPENAI_API_KEY", displayName: "OpenAI" });
  }
}

function toOpenAIMessage(m: LlmMessage): ChatCompletionMessageParam {
  if (m.role === "tool") {
    return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
  }
  if (m.role === "assistant" && "toolCalls" in m) {
    return {
      role: "assistant",
      content: m.content || null,
      tool_calls: m.toolCalls.map((c) => ({
        id: c.id,
        type: "function",
        function: { name: c.name, arguments: JSON.stringify(c.arguments) },
      })),
    };
  }
  return { role: m.role, content: m.content } as ChatCompletionMessageParam;
}

function safeParse(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}
