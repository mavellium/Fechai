# Módulo: ai

## O que faz

Única porta de entrada para IA no sistema. Quem chama não sabe (nem deve saber) qual provedor respondeu — trocar Gemini por OpenAI, Claude ou um modelo self-hosted é escrever um adapter e registrá-lo no catálogo.

## Arquivos

- `types.ts` — contratos (`LLMProvider`, `LlmMessage`, `LlmToolSchema`, `LlmResult`) e `AiError` com códigos `rate_limit | quota_exceeded | auth | provider` + `userMessage` (PT-BR, seguro para mostrar ao lead).
- `providers/gemini.ts` — adapter do Gemini via REST (`generateContent`, sem SDK). Mapeia function calling nos dois sentidos, sintetiza id de tool call (`nome::índice`) e sanitiza o JSON Schema para o subconjunto que o Gemini aceita.
- `providers/openai.ts` — adapter da OpenAI (SDK).
- `catalog.ts` — `AI_MODELS`: id, provedor, tier free/pago, limites, custo/1M, env var exigida. É o que o admin lista.
- `settings.ts` — modelo ativo lido/gravado em `AiSetting` (linha única, id `singleton`), cache de 30s. Banco fora do ar → cai no padrão do catálogo, não derruba o agente.
- `embeddings.ts` — RAG. Gemini (`gemini-embedding-001`, `outputDimensionality: 1536`, normalizado) ou OpenAI (`text-embedding-3-small`). **1536 dims é fixo** — é a largura da coluna `KnowledgeChunk.embedding`.
- `index.ts` — `getLLMProvider()` (async: lê o modelo ativo) e `createProvider(model)`.

## Contratos expostos

```ts
getLLMProvider(): Promise<LLMProvider>        // modelo ativo, definido em /admin/ia
setActiveModelId(id, updatedBy?): Promise<AiModelInfo>
embedTexts(texts): Promise<number[][] | null> // null = nenhum provedor configurado
isAiError(e): e is AiError
```

Consumidores: `agent-engine/orchestrator` (turno do agente), `knowledge-base` (via ponte em `knowledge-base/embeddings.ts`), `app/(admin)/admin/ia`, `lib/health`.

## Como adicionar um provedor

1. `providers/<nome>.ts` implementando `LLMProvider`.
2. Entrada em `AI_MODELS` (`catalog.ts`) com limites e custo.
3. Um `case` em `createProvider()` (`index.ts`).

Nenhum outro arquivo do projeto muda.

## O que NÃO faz

- Não decide *o que* perguntar ao modelo — persona, RAG e tools são do `agent-engine`.
- Não valida cota antecipadamente: descobre o limite pelo erro 429 e traduz para `rate_limit`/`quota_exceeded`.
