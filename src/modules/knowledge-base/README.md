# Módulo: knowledge-base

## O que faz

Ingesta documentos do tenant (texto/PDF), quebra em chunks, gera embeddings (OpenAI) e guarda em pgvector para busca semântica (RAG). Base que o agente consulta ao responder.

## Arquivos

- `extract.ts` — `extractTextFromFile(file)`: texto de `.txt/.md` (direto) e `.pdf` (pdf-parse, import dinâmico).
- `chunk.ts` — `chunkText(text)`: ~800 chars por chunk, com sobreposição, quebrando por parágrafo.
- `embeddings.ts` — `embedTexts`/`embedQuery` (modelo `text-embedding-3-small`, 1536 dims). `isEmbeddingConfigured()`. Sem `OPENAI_API_KEY` retorna `null` (degrada com graça).
- `repository.ts` — `ingestDocument`, `listDocuments`, `getDocument`, `updateDocument`, `deleteDocument`, `searchSimilarChunks` (usado no Milestone 5).

## Contratos expostos

```ts
ingestDocument({ tenantId, agentId, title, content, fileUrl?, fileName? }) -> doc (status: ready|failed|no_embeddings)
listDocuments(tenantId, agentId); deleteDocument(tenantId, documentId)
getDocument(tenantId, agentId, documentId) -> doc com `content` (texto completo)
updateDocument(tenantId, agentId, documentId, { title, content }) -> reescreve content, apaga chunks/embeddings antigos e gera novos
searchSimilarChunks(agentId, queryEmbedding, limit?) -> {content, distance}[]
```

`listDocuments` não seleciona `content` de propósito (a lista não usa e o
texto pode ser grande) — `getDocument` existe só para a tela de ver/editar
buscar sob demanda. UI em `agentes/ViewEditDocumentDialog.tsx`.

## Detalhes

- Coluna `embedding vector(1536)` é `Unsupported` no Prisma → gravada/consultada via `$executeRaw`/`$queryRaw`. Distância por cosseno (`<=>`).
- **Toda** query filtra por `tenantId`.
- `fileUrl`/`fileName`: o arquivo original enviado pelo cliente (`addDocument` em `agentes/actions.ts`) é guardado na BunnyCDN via `@/lib/bunny` — `content` continua sendo só o texto extraído para o RAG. `deleteDocument` apaga o arquivo da CDN junto com a linha.

## O que NÃO faz

- Não decide *quando* buscar — isso é do `agent-engine` (Milestone 5).
- Não faz OCR de imagens nem parsing de planilhas.
- Não cria índice ivfflat/hnsw automaticamente (adicionar via migration quando o volume exigir).
