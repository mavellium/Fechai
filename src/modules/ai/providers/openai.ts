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
} from "../types";

/** Adapter da OpenAI. Todo acoplamento com o SDK mora aqui. */
export class OpenAIProvider implements LLMProvider {
  readonly provider = "openai" as const;
  private client: OpenAI | null = null;

  constructor(readonly model: string) {}

  isConfigured() {
    return Boolean(process.env.OPENAI_API_KEY);
  }

  private getClient() {
    this.client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    return this.client;
  }

  async complete(messages: LlmMessage[], tools: LlmToolSchema[]): Promise<LlmResult> {
    if (!this.isConfigured()) {
      return {
        content:
          "Recebi sua mensagem! (IA em modo de demonstração — configure OPENAI_API_KEY para respostas reais.)",
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
    const ctx = { provider: this.provider, model: this.model, cause: err } as const;
    if (err instanceof APIError) {
      if (err.status === 429) {
        // A OpenAI usa 429 tanto para rate limit quanto para crédito acabado.
        const outOfCredit = /quota|billing|insufficient/i.test(err.message);
        return new AiError(
          outOfCredit ? "quota_exceeded" : "rate_limit",
          `OpenAI: ${err.message}`,
          ctx,
        );
      }
      if (err.status === 401 || err.status === 403) {
        return new AiError("auth", `OpenAI credencial inválida: ${err.message}`, ctx);
      }
      return new AiError("provider", `OpenAI erro ${err.status}: ${err.message}`, ctx);
    }
    return new AiError("provider", `OpenAI falhou: ${String(err)}`, ctx);
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
