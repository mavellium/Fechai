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
- `summary.ts` — `summarizeConversation(tenantId, conversationId)`: resumo em texto da conversa, sob demanda, com cache no banco. Ver seção abaixo.

## Contratos expostos

```ts
runAgentTurn(input) -> { reply, toolsUsed, status } // status: ok|agent_off|human_handling|no_agent
getOrCreateConversation(tenantId, phone, name?, { isTest? }) -> { lead, conversation }
startFreshTestConversation(tenantId, phone) -> void
sendManualReply(tenantId, conversationId, text) -> { ok: true } | { ok: false, error }
summarizeConversation(tenantId, conversationId) -> { ok: true, summary, summaryAt, messageCount } | { ok: false, error }
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

#### Escrever dos dois lados dentro da conversa de teste

Numa conversa com `isTest: true`, a caixa de resposta de `/conversas` ganha um
seletor de lado (`SendMessageForm`, `SegmentedControl` "você | cliente"):

| lado | action | o que acontece |
| --- | --- | --- |
| **você** | `sendManualMessage` → `sendManualReply` | grava `assistant`/`sentBy: "human"` e liga `agentPaused` |
| **cliente** | `sendTestClientMessage` → `runAgentTurn` | grava `user` e o agente responde de verdade |

Existe porque testar de dentro de uma conversa aberta era meio caminho: a
caixa só sabia escrever como o dono da conta (e ainda pausava a IA), então
para ver o agente responder era preciso sair para o diálogo "Testar agente" —
que sempre começa do zero, sem o histórico da conversa aberta.

`sendTestClientMessage` recusa qualquer conversa que não seja de teste
(`isTest: true` no `where`, junto do `tenantId`): forjar numa conversa real uma
mensagem "do cliente" que ele nunca mandou envenenaria o histórico e os
relatórios. Usa `skipUsageCheck: true` pelo mesmo motivo do `/api/sandbox` —
teste não é atendimento.

O `status` do turno volta para a interface e vira aviso quando o agente fica
calado (`human_handling` = pausado nesta conversa, `agent_off` = chave geral
desligada, `no_agent`, `limit_reached`). Sem isso, escrever como cliente e não
ver resposta parecia bug, sendo que cada um desses silêncios é o comportamento
correto — só que por uma causa diferente.

O seletor nasce **recolhido**, atrás de um botão "Enviando como você/cliente":
aberto, ele custava duas linhas acima do campo em toda mensagem enviada. O
lado atual continua impresso no próprio botão quando fechado — esconder o
controle não pode esconder o estado.

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

### Resumo da conversa (`summary.ts`)

`summarizeConversation(tenantId, conversationId)` gera um resumo em texto do
que foi conversado — "o que o cliente quer / onde parou / próximo passo", mais
uma linha "Atenção:" quando aparece orçamento, data, objeção ou reclamação.
Existe porque o painel só sabia mostrar a conversa inteira: resolve o caso de 6
mensagens e falha no de 60, onde saber se o cliente já visitou o imóvel exigia
reler tudo a cada vez que a conversa era reaberta.

Grava em três colunas de `Conversation`:

| coluna | o que é |
| --- | --- |
| `summary` | o texto. `null` = nunca resumida |
| `summaryAt` | quando foi gerado (a UI mostra "há X") |
| `summaryMsgCount` | quantas mensagens existiam na hora |

**Sob demanda, nunca automático.** Resumir dentro de `runAgentTurn` dobraria o
gasto de tokens de toda mensagem recebida — e esse consumo conta na cota do
plano (`modules/billing/usage.ts`) — para produzir um resumo que talvez
ninguém leia. Quem paga o resumo é quem clica em "Resumir conversa".

**`summaryMsgCount` é o que torna o cache honesto.** Comparado com a contagem
atual de mensagens, permite a interface dizer "4 mensagens novas desde este
resumo" sem gastar uma chamada para descobrir. A UI **não regera sozinha**
nesse caso: um resumo velho que se anuncia velho é melhor do que um custo
silencioso a cada abertura de conversa.

Outros detalhes que valem saber antes de mexer:

- **Sem tools** (`complete(messages, [])`): é leitura pura; passar os schemas
  de ação abriria espaço para o modelo tentar agendar reunião no meio de um
  resumo.
- **Máximo de 60 mensagens** no prompt (`MAX_MESSAGES_IN_PROMPT`), as mais
  recentes, mas reordenadas em ordem cronológica antes de ir ao modelo —
  mandar o histórico de trás para frente produzia resumo invertido.
- **Mínimo de 4 mensagens** (`MIN_MESSAGES_TO_SUMMARIZE`): abaixo disso ler é
  mais rápido, e o servidor recusa (o cliente espelha a constante só para
  esconder o botão).
- **A gravação usa `$executeRaw`, não `prisma.conversation.update`**, porque
  `updatedAt` tem `@updatedAt`: qualquer escrita pelo client o reescreveria, e
  essa coluna ordena a caixa de entrada — gerar um resumo não pode empurrar a
  conversa para o topo como se o cliente tivesse escrito. O `tenantId` continua
  no `WHERE`.
- **Fallback próprio** (Gemini → Grok → Groq), duplicando a ideia do
  orquestrador em vez de reusar a função dele: mantém o caminho quente do
  atendimento livre de parâmetros que só o resumo precisa. O uso de tokens é
  registrado com `recordUsage` no provider que de fato respondeu.

Onde aparece: `conversas/ConversationSummary.tsx` (bloco no `LeadPanel`, no
topo do `ConversationThread` em xl+ — ali dentro de um `<details>` **fechado
por padrão**, porque aberto comia um terço da altura do histórico, que é a
área que importa naquela coluna; o texto completo continua sempre visível na
coluna do cliente, então ali ele é atalho, não a via principal — e no
`<details>` mobile) e, como texto
pronto, nas linhas e cards de `/contatos` — lá o resumo substitui a prévia da
última mensagem quando existe, porque "ok, obrigado" não diz nada sobre o que
o cliente queria. A action é `generateConversationSummary` em
`conversas/actions.ts`.

## O que NÃO faz

- Não fala com o WhatsApp — quem envia é o `whatsapp` provider (chamado pelo webhook, ou por `sendManualMessage` numa resposta manual).
- Não dispara follow-up no tempo — isso é o worker (Milestone 6); a tool só sinaliza.
- Não resume conversa sozinho: `summarizeConversation` só roda quando alguém pede pela interface (ver seção acima).
