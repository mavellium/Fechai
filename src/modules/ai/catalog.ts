import type { ProviderKey } from "./types";

/**
 * Catálogo de modelos oferecidos no painel admin.
 *
 * Os números de limite/preço são REFERÊNCIA para a decisão de quem troca o
 * modelo — não são consultados em runtime. Google revisa o free tier sem aviso
 * (cortou 50-80% em dez/2025), então trate como estimativa e confira em
 * https://ai.google.dev/gemini-api/docs/rate-limits antes de prometer volume.
 * Última conferência: 2026-07-24 (ver docs/pesquisa-llm-2026-07.md).
 */
export type AiModelInfo = {
  id: string;
  provider: ProviderKey;
  label: string;
  tier: "free" | "paid";
  /** Para que serve / quando escolher. */
  description: string;
  /** Limites relevantes (free tier) ou throughput (pago). */
  limits: string;
  /** Custo por 1M tokens entrada/saída. */
  pricing: string;
  /** Exige chave do provedor nesta env var. */
  envKey: "GEMINI_API_KEY" | "OPENAI_API_KEY" | "XAI_API_KEY";
};

export const AI_MODELS: AiModelInfo[] = [
  {
    id: "gemini-2.5-flash",
    provider: "gemini",
    label: "Gemini 2.5 Flash",
    tier: "free",
    description: "Modelo mais rápido e versátil. Padrão recomendado.",
    limits: "Sem limite específico no free tier",
    pricing: "Grátis no free tier",
    envKey: "GEMINI_API_KEY",
  },
  {
    id: "gemini-2.0-flash-lite",
    provider: "gemini",
    label: "Gemini 2.0 Flash Lite",
    tier: "free",
    description: "Versão mais leve, ideal para processos em cadeia.",
    limits: "Sem limite específico no free tier",
    pricing: "Grátis no free tier",
    envKey: "GEMINI_API_KEY",
  },
  {
    id: "gemini-2.5-pro",
    provider: "gemini",
    label: "Gemini 2.5 Pro",
    tier: "free",
    description: "Melhor raciocínio e análise. Use quando precisar de mais qualidade.",
    limits: "Sem limite específico no free tier",
    pricing: "Grátis no free tier",
    envKey: "GEMINI_API_KEY",
  },
  {
    id: "gemini-3.5-flash",
    provider: "gemini",
    label: "Gemini 3.5 Flash",
    tier: "free",
    description: "Modelo mais recente com melhorias de qualidade e velocidade.",
    limits: "Sem limite específico no free tier",
    pricing: "Grátis no free tier",
    envKey: "GEMINI_API_KEY",
  },
  {
    id: "gemini-3.6-flash",
    provider: "gemini",
    label: "Gemini 3.6 Flash",
    tier: "paid",
    description: "Geração atual paga do Flash. Exige billing ativo no Google AI Studio.",
    limits: "Sem cota diária (rate limit por tier de billing)",
    pricing: "US$ 1,50 / US$ 7,50",
    envKey: "GEMINI_API_KEY",
  },
  {
    id: "gpt-4o-mini",
    provider: "openai",
    label: "GPT-4o mini",
    tier: "paid",
    description: "Fallback histórico do projeto. Requer OPENAI_API_KEY com crédito.",
    limits: "Rate limit por tier da conta OpenAI",
    pricing: "US$ 0,15 / US$ 0,60",
    envKey: "OPENAI_API_KEY",
  },
  {
    id: "grok-4.3",
    provider: "grok",
    label: "Grok 4.3",
    tier: "paid",
    description:
      "Fallback automático quando o Gemini do plano gratuito falha (cota, rate limit ou erro). Requer XAI_API_KEY com crédito.",
    limits: "Cota por tier da conta xAI",
    pricing: "US$ 0,75 / US$ 2,50",
    envKey: "XAI_API_KEY",
  },
];

/** Modelo usado quando não há nada salvo no banco. */
export const DEFAULT_MODEL_ID = "gemini-2.5-flash";

/** Fallback chain: lista de modelos para tentar caso o principal falhe. */
export const GEMINI_FALLBACK_CHAIN = ["gemini-2.5-flash", "gemini-2.0-flash-lite", "gemini-2.5-pro"];

/** Modelo xAI usado como fallback quando um Gemini do free tier falha. */
export const GROK_FALLBACK_MODEL_ID = "grok-4.3";

/**
 * Se o modelo atual é um Gemini do free tier e há chave xAI configurada,
 * devolve o modelo Grok de fallback; caso contrário `undefined`.
 */
export function getGrokFallbackModel(modelId: string): string | undefined {
  const model = findModel(modelId);
  if (!model || model.provider !== "gemini" || model.tier !== "free") return undefined;
  if (!process.env.XAI_API_KEY) return undefined;
  return GROK_FALLBACK_MODEL_ID;
}

export function findModel(id: string): AiModelInfo | undefined {
  return AI_MODELS.find((m) => m.id === id);
}
