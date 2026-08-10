import { OpenAICompatProvider } from "./openai";

/**
 * Adapter da xAI (Grok). A API deles é compatível com a da OpenAI (mesmo
 * formato de messages/tools), então toda a lógica mora na base; aqui só
 * apontamos o baseURL e a env var da chave.
 */
export class GrokProvider extends OpenAICompatProvider {
  constructor(model: string) {
    super(model, {
      provider: "grok",
      envKey: "XAI_API_KEY",
      baseURL: "https://api.x.ai/v1",
      displayName: "xAI",
    });
  }
}
