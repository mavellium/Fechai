/**
 * Ponte de compatibilidade: a implementação vive em `src/modules/ai/embeddings`
 * junto com os demais providers de IA. Mantido para não espalhar o import
 * `@/modules/ai` pelos repositórios da base de conhecimento.
 */
export {
  EMBEDDING_DIMS,
  isEmbeddingConfigured,
  activeEmbeddingModel,
  embedTexts,
  embedQuery,
} from "@/modules/ai/embeddings";
