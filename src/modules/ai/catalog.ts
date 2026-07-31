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
  envKey: "GEMINI_API_KEY" | "OPENAI_API_KEY";
};

export const AI_MODELS: AiModelInfo[] = [
  {
    id: "gemini-2.5-flash",
    provider: "gemini",
    label: "Gemini 2.5 Flash",
    tier: "free",
    description: "Equilíbrio entre qualidade e cota. Padrão recomendado para o agente.",
    limits: "10 RPM · 250 req/dia · 250k TPM",
    pricing: "Grátis no free tier (pago: US$ 0,30 / US$ 2,50)",
    envKey: "GEMINI_API_KEY",
  },
  {
    id: "gemini-2.5-flash-lite",
    provider: "gemini",
    label: "Gemini 2.5 Flash-Lite",
    tier: "free",
    description: "Maior cota diária do free tier. Use se bater o limite do Flash.",
    limits: "15 RPM · 1.000 req/dia · 250k TPM",
    pricing: "Grátis no free tier",
    envKey: "GEMINI_API_KEY",
  },
  {
    id: "gemini-2.5-pro",
    provider: "gemini",
    label: "Gemini 2.5 Pro",
    tier: "free",
    description: "Melhor raciocínio, cota bem menor. Só para testes pontuais.",
    limits: "5 RPM · 100 req/dia · 250k TPM",
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
];

/** Modelo usado quando não há nada salvo no banco. */
export const DEFAULT_MODEL_ID = "gemini-2.5-flash";

export function findModel(id: string): AiModelInfo | undefined {
  return AI_MODELS.find((m) => m.id === id);
}
