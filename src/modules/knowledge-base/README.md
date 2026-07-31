# Módulo: knowledge-base

## O que faz

Ingesta documentos do tenant (texto/PDF), quebra em chunks, gera embeddings (OpenAI) e guarda em pgvector para busca semântica (RAG). Base que o agente consulta ao responder.

## Arquivos

- `extract.ts` — `extractTextFromFile(file)`: texto de `.txt/.md` (direto) e `.pdf` (pdf-parse, import dinâmico).
- `chunk.ts` — `chunkText(text)`: ~800 chars por chunk, com sobreposição, quebrando por parágrafo.
- `embeddings.ts` — `embedTexts`/`embedQuery` (modelo `text-embedding-3-small`, 1536 dims). `isEmbeddingConfigured()`. Sem `OPENAI_API_KEY` retorna `null` (degrada com graça).
- `repository.ts` — `ingestDocument`, `listDocuments`, `deleteDocument`, `searchSimilarChunks` (usado no Milestone 5).

## Contratos expostos

```ts
ingestDocument({ tenantId, title, content }) -> doc (status: ready|failed|no_embeddings)
listDocuments(tenantId); deleteDocument(tenantId, documentId)
searchSimilarChunks(tenantId, queryEmbedding, limit?) -> {content, distance}[]
```

## Detalhes

- Coluna `embedding vector(1536)` é `Unsupported` no Prisma → gravada/consultada via `$executeRaw`/`$queryRaw`. Distância por cosseno (`<=>`).
- **Toda** query filtra por `tenantId`.

## O que NÃO faz

- Não decide *quando* buscar — isso é do `agent-engine` (Milestone 5).
- Não faz OCR de imagens nem parsing de planilhas.
- Não cria índice ivfflat/hnsw automaticamente (adicionar via migration quando o volume exigir).
