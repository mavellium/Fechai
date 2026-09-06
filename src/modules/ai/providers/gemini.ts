import {
  AiError,
  type LLMProvider,
  type LlmMessage,
  type LlmResult,
  type LlmToolCall,
  type LlmToolSchema,
} from "../types";

/**
 * Adapter do Google Gemini via REST (sem SDK).
 *
 * Motivo de não usar `@google/genai`: o contrato do generateContent é estável e
 * pequeno, e assim a troca de provedor não arrasta dependência nem breaking
 * change de SDK. Todo o acoplamento com o formato do Gemini mora neste arquivo.
 */
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args?: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };

export class GeminiProvider implements LLMProvider {
  readonly provider = "gemini" as const;

  /**
   * Chave cadastrada no painel, quando o degrau da cadeia aponta para uma.
   * Sem ela vale a do `.env` — ver `src/modules/ai/credentials.ts`.
   */
  constructor(
    readonly model: string,
    private readonly apiKeyOverride?: string,
  ) {}

  private apiKey(): string | undefined {
    return this.apiKeyOverride ?? process.env.GEMINI_API_KEY;
  }

  isConfigured() {
    return Boolean(this.apiKey());
  }

  async complete(messages: LlmMessage[], tools: LlmToolSchema[]): Promise<LlmResult> {
    const apiKey = this.apiKey();
    if (!apiKey) {
      // Mesma degradação graciosa do resto do app: sem chave, não quebra o fluxo.
      return {
        content:
          "Recebi sua mensagem! (IA em modo de demonstração — configure GEMINI_API_KEY para respostas reais.)",
        toolCalls: [],
      };
    }

    const { systemInstruction, contents } = toGeminiContents(messages);

    const body: Record<string, unknown> = { contents };
    if (systemInstruction) body.systemInstruction = { parts: [{ text: systemInstruction }] };
    if (tools.length > 0) {
      body.tools = [
        {
          functionDeclarations: tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: sanitizeSchema(t.parameters),
          })),
        },
      ];
    }

    const res = await fetch(`${API_BASE}/${this.model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw await this.toAiError(res);

    const json = (await res.json()) as {
      candidates?: { content?: { parts?: GeminiPart[] } }[];
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
      };
    };
    const parts = json.candidates?.[0]?.content?.parts ?? [];

    const text = parts
      .filter((p): p is { text: string } => "text" in p)
      .map((p) => p.text)
      .join("")
      .trim();

    // O Gemini não devolve id de tool call; sintetizamos um que carrega o nome
    // para conseguir remontar o functionResponse na volta.
    const toolCalls: LlmToolCall[] = parts
      .filter((p): p is { functionCall: { name: string; args?: Record<string, unknown> } } =>
        "functionCall" in p,
      )
      .map((p, i) => ({
        id: `${p.functionCall.name}::${i}`,
        name: p.functionCall.name,
        arguments: p.functionCall.args ?? {},
      }));

    // Extração isolada, mesmo princípio do OpenAICompatProvider: a resposta em
    // texto já foi montada acima e não depende disso — `usageMetadata` ausente
    // ou malformado só deixa o registro de consumo sem esse dado.
    let usage: LlmResult["usage"];
    try {
      const u = json.usageMetadata;
      if (u && u.promptTokenCount !== undefined && u.candidatesTokenCount !== undefined) {
        usage = {
          promptTokens: u.promptTokenCount,
          completionTokens: u.candidatesTokenCount,
          totalTokens: u.totalTokenCount ?? u.promptTokenCount + u.candidatesTokenCount,
        };
      }
    } catch {
      usage = undefined;
    }

    return { content: text, toolCalls, usage };
  }

  /** Traduz o erro HTTP do Gemini para o vocabulário da nossa camada. */
  private async toAiError(res: Response): Promise<AiError> {
    const raw = await res.text();
    let message = raw.slice(0, 300);
    let status = "";
    try {
      const parsed = JSON.parse(raw) as { error?: { message?: string; status?: string } };
      message = parsed.error?.message ?? message;
      status = parsed.error?.status ?? "";
    } catch {
      /* resposta não-JSON: mantém o texto cru truncado */
    }

    const ctx = { provider: this.provider, model: this.model } as const;

    if (res.status === 429 || status === "RESOURCE_EXHAUSTED") {
      const retryAfter = Number(res.headers.get("retry-after")) || undefined;
      // O free tier estoura tanto por minuto (RPM) quanto por dia (RPD); a
      // mensagem do Google diferencia — "per day"/"PerDay" indica cota diária.
      const daily = /per\s*day|PerDay|daily/i.test(message);
      return new AiError(
        daily ? "quota_exceeded" : "rate_limit",
        `Gemini ${daily ? "cota diária esgotada" : "rate limit"}: ${message}`,
        { ...ctx, retryAfterSeconds: retryAfter },
      );
    }
    if (res.status === 401 || res.status === 403) {
      return new AiError("auth", `Gemini credencial inválida: ${message}`, ctx);
    }
    return new AiError("provider", `Gemini erro ${res.status}: ${message}`, ctx);
  }
}

/** system → systemInstruction; o resto vira `contents` no formato do Gemini. */
function toGeminiContents(messages: LlmMessage[]): {
  systemInstruction: string;
  contents: GeminiContent[];
} {
  const systemParts: string[] = [];
  const contents: GeminiContent[] = [];

  for (const m of messages) {
    if (m.role === "system") {
      systemParts.push(m.content);
      continue;
    }
    if (m.role === "tool") {
      // id sintetizado como `nome::indice` (ver complete()).
      const name = m.toolCallId.split("::")[0] ?? "tool";
      contents.push({
        role: "user",
        parts: [{ functionResponse: { name, response: { result: m.content } } }],
      });
      continue;
    }
    if (m.role === "assistant" && "toolCalls" in m) {
      const parts: GeminiPart[] = m.toolCalls.map((c) => ({
        functionCall: { name: c.name, args: c.arguments },
      }));
      if (m.content) parts.unshift({ text: m.content });
      contents.push({ role: "model", parts });
      continue;
    }
    contents.push({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    });
  }

  return { systemInstruction: systemParts.join("\n\n"), contents };
}

/**
 * O Gemini aceita só um subconjunto do JSON Schema e rejeita a requisição
 * inteira com 400 se aparecer chave desconhecida (ex.: `additionalProperties`).
 */
const ALLOWED_SCHEMA_KEYS = new Set([
  "type",
  "description",
  "properties",
  "required",
  "items",
  "enum",
  "format",
  "nullable",
]);

function sanitizeSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (!ALLOWED_SCHEMA_KEYS.has(key)) continue;
    if (key === "properties" && value && typeof value === "object") {
      out.properties = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, sanitizeSchema(v)]),
      );
    } else if (key === "items") {
      out.items = sanitizeSchema(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}
