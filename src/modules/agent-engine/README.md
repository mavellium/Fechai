# Módulo: agent-engine

## O que faz

Cérebro do produto: recebe uma mensagem, monta o contexto (persona + RAG + histórico), roda function calling com as ações ativas, executa os handlers e devolve a resposta.

## Arquivos

- `actions.ts` — `ACTION_CATALOG` (key, label, descrição, status ready|stub) e `ACTION_BY_KEY`.
- `persona.ts` — `PERSONA_FIELDS` (wizard) e `composeSystemPrompt(answers)` → `AgentConfig.systemPrompt`.
- ~~`llm.ts`~~ — removido. A camada de IA mora em `src/modules/ai` (providers Gemini/OpenAI, catálogo, modelo ativo no banco). Use `import { getLLMProvider } from "@/modules/ai"` — é `async`.
- `tools.ts` — schemas + handlers por ação (`getToolSchemas`, `runToolHandler`). Handlers gravam no banco (lead/conversation).
- `conversation.ts` — `getOrCreateConversation`, `appendMessage`, `getRecentMessages`.
- `orchestrator.ts` — `runAgentTurn({tenantId, conversationId, leadId, userMessage})`: loop de tools (máx 3), RAG via `searchSimilarChunks`, persiste mensagens.

## Contratos expostos

```ts
runAgentTurn(input) -> { reply, toolsUsed }
getOrCreateConversation(tenantId, phone, name?) -> { lead, conversation }
composeSystemPrompt(answers): string; ACTION_CATALOG: ActionDef[]
```

Consumidores: `api/webhooks/whatsapp` (WhatsApp real) e `api/sandbox` (chat de teste).

## O que NÃO faz

- Não fala com o WhatsApp — quem envia é o `whatsapp` provider (chamado pelo webhook).
- Não dispara follow-up no tempo — isso é o worker (Milestone 6); a tool só sinaliza.
