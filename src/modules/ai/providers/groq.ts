import { OpenAICompatProvider } from "./openai";

/**
 * Adapter da Groq. API compatível com a OpenAI (mesmo formato de
 * messages/tools); aqui só apontamos o baseURL e a env var da chave.
 */
export class GroqProvider extends OpenAICompatProvider {
  constructor(model: string) {
    super(model, {
      provider: "groq",
      envKey: "GROQ_API_KEY",
      baseURL: "https://api.groq.com/openai/v1",
      displayName: "Groq",
    });
  }
}
