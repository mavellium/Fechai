import { OpenAICompatProvider } from "./openai";

/**
 * Provedor cadastrado pelo admin, sem deploy.
 *
 * Funciona porque o formato `/chat/completions` da OpenAI virou padrão de
 * fato: DeepSeek, Together, OpenRouter, Mistral, Fireworks, Ollama e vLLM
 * expõem a mesma interface. Um adapter só, com a URL base e o nome do modelo
 * vindos do banco, cobre todos — é o que permite acrescentar um provedor que o
 * projeto nunca viu sem tocar no código.
 *
 * O que ele NÃO cobre: APIs de formato próprio (o Gemini é o caso aqui
 * dentro). Para essas, continua sendo preciso um adapter dedicado em
 * `providers/`.
 */
export class CustomProvider extends OpenAICompatProvider {
  constructor(model: string, baseURL: string, apiKey: string, displayName: string) {
    super(
      model,
      {
        // Reporta-se como "custom" no registro de uso: o painel agrupa por
        // provedor, e um nome digitado pelo admin não pode virar chave de
        // agregação (dois rótulos diferentes para o mesmo serviço quebrariam
        // a contagem).
        provider: "custom",
        envKey: "",
        baseURL,
        displayName,
      },
      apiKey,
    );
  }
}
