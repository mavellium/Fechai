import { GeminiProvider } from "./providers/gemini";
import { OpenAIProvider } from "./providers/openai";
import { GrokProvider } from "./providers/grok";
import { GroqProvider } from "./providers/groq";
import { CustomProvider } from "./providers/custom";
import { getActiveModel } from "./settings";
import type { AiModelInfo } from "./catalog";
import type { LLMProvider } from "./types";

export * from "./types";
export { AI_MODELS, DEFAULT_MODEL_ID, findModel, type AiModelInfo } from "./catalog";
export { getActiveModel, getActiveModelId, setActiveModelId, getAiSettingMeta } from "./settings";
export { getUsableChain, getCooldownMinutes, invalidateChainCache, type ChainStep } from "./chain";
export { resolveSecret, markCredentialCooldown, markCredentialOk } from "./credentials";

/**
 * Ponto único de entrada da IA no sistema.
 *
 * Provedor com API no formato da OpenAI **não precisa de código**: o admin
 * cadastra URL base, modelo e chave em /admin/ia e cai no `CustomProvider`.
 * Adapter novo aqui só para API de formato próprio (como o Gemini): escreva em
 * `providers/`, registre o modelo em `catalog.ts` e some um case abaixo.
 */
export function createProvider(model: AiModelInfo, apiKey?: string): LLMProvider {
  switch (model.provider) {
    case "gemini":
      return new GeminiProvider(model.id, apiKey);
    case "openai":
      return new OpenAIProvider(model.id, apiKey);
    case "grok":
      return new GrokProvider(model.id, apiKey);
    case "groq":
      return new GroqProvider(model.id, apiKey);
    case "custom":
      // Sem URL ou sem chave o provedor não existe de fato — cair no
      // OpenAIProvider silenciosamente mandaria a chamada para a OpenAI com a
      // credencial de outro serviço.
      if (!model.baseUrl || !apiKey) {
        throw new Error(`Provedor "${model.label}" está sem URL base ou chave.`);
      }
      return new CustomProvider(model.id, model.baseUrl, apiKey, model.label);
  }
}

const instances = new Map<string, LLMProvider>();

/** Provider do modelo ativo (definido no painel admin). */
export async function getLLMProvider(): Promise<LLMProvider> {
  const model = await getActiveModel();
  let provider = instances.get(model.id);
  if (!provider) {
    provider = createProvider(model);
    instances.set(model.id, provider);
  }
  return provider;
}
