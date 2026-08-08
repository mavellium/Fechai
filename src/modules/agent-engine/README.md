# Módulo: agent-engine

## O que faz

Cérebro do produto: recebe uma mensagem, monta o contexto (persona + RAG + histórico), roda function calling com as ações ativas, executa os handlers e devolve a resposta.

## Arquivos

- `actions.ts` — `ACTION_CATALOG` (key, label, descrição, status ready|stub) e `ACTION_BY_KEY`.
- `persona.ts` — `PERSONA_FIELDS` (wizard) e `composeSystemPrompt(answers)` → `AgentConfig.systemPrompt`.
- ~~`llm.ts`~~ — removido. A camada de IA mora em `src/modules/ai` (providers Gemini/OpenAI, catálogo, modelo ativo no banco). Use `import { getLLMProvider } from "@/modules/ai"` — é `async`.
- `tools.ts` — schemas + handlers por ação (`getToolSchemas`, `runToolHandler`). Handlers gravam no banco (lead/conversation).
- `conversation.ts` — `getOrCreateConversation`, `appendMessage`, `getRecentMessages`, `startFreshTestConversation`, `sendManualReply`.
- `orchestrator.ts` — `runAgentTurn({tenantId, conversationId, leadId, userMessage})`: loop de tools (máx 3), RAG via `searchSimilarChunks`, persiste mensagens.

## Contratos expostos

```ts
runAgentTurn(input) -> { reply, toolsUsed, status } // status: ok|agent_off|human_handling|no_agent
getOrCreateConversation(tenantId, phone, name?, { isTest? }) -> { lead, conversation }
startFreshTestConversation(tenantId, phone) -> void
sendManualReply(tenantId, conversationId, text) -> { ok: true } | { ok: false, error }
composeSystemPrompt(answers): string; ACTION_CATALOG: ActionDef[]
```

Consumidores: `api/webhooks/whatsapp` (WhatsApp real) e `api/sandbox` (chat de teste).

### Conversa de teste (sandbox)

`getOrCreateConversation` com `isTest: true` cria lead/conversa marcados — ficam
fora de Contatos e Relatórios, mas **aparecem em `/conversas`** (aba "Testes"),
com histórico permanente. O botão "Recomeçar" do sandbox chama
`startFreshTestConversation`: em vez de apagar, arquiva a conversa atual
(muda o telefone para `sandbox:<agentId>:archived:<timestamp>`, fora do
caminho de busca) e libera o telefone canônico para nascer vazio na próxima
mensagem — a IA não recomeça vendo o histórico do teste anterior, mas nada é
perdido do lado do usuário.

### Resposta manual e humano assumindo a conversa (`sendManualReply`, `agentPaused`)

`sendManualReply(tenantId, conversationId, text)` é o núcleo de "o dono da
conta respondeu pelo painel em vez do agente" — usado por
`conversas/actions.ts` (`sendManualMessage`, a partir de uma conversa aberta)
e `contatos/actions.ts` (`sendMessageToContact`, a partir de um lead); as duas
telas faziam essa lógica em duplicado, cada uma só com metade do cuidado,
antes desta função existir. Numa conversa real envia de verdade pelo
`WhatsAppProvider`; numa de teste (sandbox) só grava, sem WhatsApp envolvido.

Sempre grava com `sentBy: "human"` e liga `Conversation.agentPaused`.
`runAgentTurn` checa `agentPaused` logo no início: se ligado, persiste a
mensagem do contato e retorna `status: "human_handling"` sem gerar resposta —
só nesta conversa, as outras do mesmo agente continuam normais. Diferente de
`Agent.enabled` (`agent_off`), que é a chave geral e afeta todo mundo.
"Devolver para o agente" desliga `agentPaused`.

Mensagens `role: "assistant"` carregam `sentBy: "agent" | "human" | null`
(`Message.sentBy`) para diferenciar quem gerou a resposta — `role` continua
igual nos dois casos, então o histórico que `getRecentMessages` devolve para
o LLM não muda; `sentBy` é metadado só para UI/auditoria.

## O que NÃO faz

- Não fala com o WhatsApp — quem envia é o `whatsapp` provider (chamado pelo webhook, ou por `sendManualMessage` numa resposta manual).
- Não dispara follow-up no tempo — isso é o worker (Milestone 6); a tool só sinaliza.
