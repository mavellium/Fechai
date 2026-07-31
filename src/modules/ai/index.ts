import { GeminiProvider } from "./providers/gemini";
import { OpenAIProvider } from "./providers/openai";
import { getActiveModel } from "./settings";
import type { AiModelInfo } from "./catalog";
import type { LLMProvider } from "./types";

export * from "./types";
export { AI_MODELS, DEFAULT_MODEL_ID, findModel, type AiModelInfo } from "./catalog";
export { getActiveModel, getActiveModelId, setActiveModelId, getAiSettingMeta } from "./settings";

/**
 * Ponto único de entrada da IA no sistema.
 *
 * Para adicionar um provedor (Claude, self-hosted, ...): escreva o adapter em
 * `providers/`, registre o modelo em `catalog.ts` e adicione o case abaixo.
 * Nenhum outro arquivo do projeto precisa mudar.
 */
export function createProvider(model: AiModelInfo): LLMProvider {
  switch (model.provider) {
    case "gemini":
      return new GeminiProvider(model.id);
    case "openai":
      return new OpenAIProvider(model.id);
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
