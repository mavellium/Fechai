import OpenAI from "openai";

/**
 * Embeddings (RAG) com o mesmo princípio dos providers de chat: quem chama não
 * sabe qual provedor respondeu.
 *
 * A dimensão é FIXA em 1536 porque a coluna `KnowledgeChunk.embedding` é
 * `vector(1536)`. O Gemini aceita `outputDimensionality`, então dá para casar
 * sem migração. Trocar esse número exige migrar a coluna e reindexar tudo.
 */
export const EMBEDDING_DIMS = 1536;

const GEMINI_EMBEDDING_MODEL = "gemini-embedding-001";
const OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";

export function isEmbeddingConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY);
}

/** Nome do modelo em uso (para telas de status). */
export function activeEmbeddingModel(): string | null {
  if (process.env.GEMINI_API_KEY) return GEMINI_EMBEDDING_MODEL;
  if (process.env.OPENAI_API_KEY) return OPENAI_EMBEDDING_MODEL;
  return null;
}

/** Gera embeddings. `null` = nenhum provedor configurado (doc salvo sem vetor). */
export async function embedTexts(texts: string[]): Promise<number[][] | null> {
  if (texts.length === 0) return null;
  if (process.env.GEMINI_API_KEY) return embedWithGemini(texts);
  if (process.env.OPENAI_API_KEY) return embedWithOpenAI(texts);
  return null;
}

export async function embedQuery(text: string): Promise<number[] | null> {
  const out = await embedTexts([text]);
  return out?.[0] ?? null;
}

async function embedWithGemini(texts: string[]): Promise<number[][]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBEDDING_MODEL}:batchEmbedContents`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY as string,
      },
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: `models/${GEMINI_EMBEDDING_MODEL}`,
          content: { parts: [{ text }] },
          outputDimensionality: EMBEDDING_DIMS,
        })),
      }),
    },
  );

  if (!res.ok) {
    throw new Error(`Gemini embeddings ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  const json = (await res.json()) as { embeddings?: { values: number[] }[] };
  // Abaixo de 3072 dims o Google entrega vetor não normalizado; normalizamos
  // para a distância cosseno do pgvector se comportar como esperado.
  return (json.embeddings ?? []).map((e) => normalize(e.values));
}

let openaiClient: OpenAI | null = null;

async function embedWithOpenAI(texts: string[]): Promise<number[][]> {
  openaiClient ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const res = await openaiClient.embeddings.create({
    model: OPENAI_EMBEDDING_MODEL,
    input: texts,
  });
  return res.data.map((d) => d.embedding);
}

function normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((acc, x) => acc + x * x, 0));
  return norm > 0 ? v.map((x) => x / norm) : v;
}
