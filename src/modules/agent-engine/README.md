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
- `reply-sanitizer.ts` — última barreira antes de persistir/enviar: remove variáveis de template não resolvidas (`[Nome]`, `{{push_name}}` etc.) e recompõe a pontuação.
- `variables.ts` — definições por agente e valores por conversa. Nome, número e endereço existem por padrão; as demais são opcionais e configuradas em Agentes › Variáveis.
- `summary.ts` — `summarizeConversation(tenantId, conversationId)`: resumo em texto da conversa, sob demanda, com cache no banco. Ver seção abaixo.
- `disqualify.ts` — motivos da triagem (`DISQUALIFY_REASONS`), rótulos e o custo do atendimento manual que converte triagem em dinheiro. Ver seção abaixo.
- `handoff.ts` — config da ação "Transferir para humano" e `addLeadToHandoffGroup`: põe o contato num grupo do WhatsApp ao passar para atendimento. Ver seção abaixo.

## Contratos expostos

```ts
runAgentTurn(input) -> { reply, toolsUsed, status } // status: ok|agent_off|human_handling|no_agent
getOrCreateConversation(tenantId, phone, name?, { isTest? }) -> { lead, conversation }
startFreshTestConversation(tenantId, phone) -> void
sendManualReply(tenantId, conversationId, text) -> { ok: true } | { ok: false, error }
summarizeConversation(tenantId, conversationId) -> { ok: true, summary, summaryAt, messageCount } | { ok: false, error }
composeSystemPrompt(answers): string; ACTION_CATALOG: ActionDef[]
getHandoffConfig(agentId) -> HandoffConfig            // para a tela preencher o formulário
saveHandoffConfig(tenantId, agentId, config) -> void
addLeadToHandoffGroup(tenantId, agentId, phone, { isTest? }) -> void  // nunca lança
listWhatsAppGroups(tenantId) -> { ok: true, groups } | { ok: false, reason, error }  // nunca lança
handoffToolDescription(config?) -> string              // descrição de handoff_human com o motivo
```

Consumidores: `api/webhooks/whatsapp` (WhatsApp real) e `api/sandbox` (chat de teste).

### Variáveis da conversa

`Agent.variableDefinitions` guarda até 20 chaves personalizadas com descrição.
`Conversation.variables` guarda só os valores informados naquela conversa;
ausência aparece como "não informado" na lista recolhível em `/conversas`.
**Toda variável nasce "não informado" e só é preenchida pelo que a conversa
revelar.** A única exceção é `{{numero}}`: o telefone é a identidade do contato
no WhatsApp, o sistema já o conhece antes da primeira mensagem e o agente não
tem como perguntá-lo a quem está falando pelo próprio telefone — por isso ele é
controlado pelo sistema e `remember_variables` o recusa. `{{nome}}` **não** é
pré-preenchido com `Lead.name`: esse valor pode ser o apelido do perfil (ou
"Chat de teste", no sandbox), e mostrá-lo faria a tela afirmar que o contato
informou um nome que nunca disse. No chat de teste nem `{{numero}}` nasce
preenchido, porque `sandbox:<agentId>` não é um telefone. Definições inválidas
na leitura são ignoradas, e a escrita recusa chaves duplicadas ou que tentem
substituir as três padrão.

Conversas anteriores a essa regra têm o nome do perfil e o número sintético já
gravados; `scripts/limpa-variaveis-herdadas.ts` limpa o resíduo uma vez. Ele
não mexe no `{{nome}}` de conversa real de propósito: `remember_variables`
grava o nome dito **e** atualiza `Lead.name`, então os dois serem iguais não
distingue o valor herdado do legítimo.

**Resumir a conversa também preenche as variáveis** (`summary-variables.ts`).
As variáveis só se preenchem quando o agente chama `remember_variables`
durante o turno, o que deixa de fora todo o passado: conversa anterior à
variável existir, conversa atendida à mão, conversa em que o agente não chamou
a tool — o dado está escrito no histórico e a tela diz "não informado". Como o
resumo já relê a conversa inteira numa chamada que o dono pediu, o mesmo
retorno traz um bloco `<variaveis>` com os valores encontrados: recupera o
passado **sem uma segunda chamada paga**. O bloco é arrancado do texto antes de
exibir (é protocolo interno, não faz parte do resumo) e só as chaves ausentes
são pedidas — o que o agente guardou ao vivo tem prioridade sobre a releitura e
nunca é sobrescrito. O modelo é instruído a escrever "não informado" quando o
dado não aparece, e esses valores são descartados: sem essa saída explícita um
modelo pressionado a preencher todo campo preenche com o que é *provável*, que
é justamente o erro que não se pode cometer com dado de cliente. A gravação
acontece depois do resumo e num `try` próprio — a extração é um brinde da mesma
chamada e não pode derrubar o que a pessoa pediu.

O contexto do turno mostra as definições e os valores ao agente. A tool interna
`remember_variables` atualiza os valores informados, sem consumir uma vaga de
habilidade; chaves não configuradas e valores vazios são recusados. Ao mudar
`{{nome}}`, o nome do contato também é atualizado. A resposta final substitui
valores conhecidos e remove tokens ausentes antes de salvar ou enviar; o
follow-up aplica a mesma barreira. Lembretes aceitam as variáveis da conversa
como extras, além de data/hora/local da consulta. Exportar ou duplicar o agente
leva as definições, nunca os valores das conversas.

### Conversa de teste (sandbox)

`getOrCreateConversation` com `isTest: true` cria lead/conversa marcados — ficam
fora de Contatos e Relatórios, mas **aparecem em `/conversas`** (aba "Testes"),
com histórico permanente. O botão "Recomeçar" do sandbox chama
`startFreshTestConversation`: em vez de apagar, arquiva a conversa atual
(muda o telefone para `sandbox:<agentId>:archived:<timestamp>`, fora do
caminho de busca) e libera o telefone canônico para nascer vazio na próxima
mensagem — a IA não recomeça vendo o histórico do teste anterior, mas nada é
perdido do lado do usuário.

#### O teste responde com o agente desligado (`skipEnabledCheck`)

`Agent.enabled` é a chave geral, e desligada ela cala o agente **para o
cliente** — WhatsApp e widget do site. O chat de teste é a exceção: os dois
caminhos de teste (`/api/sandbox` e `sendTestClientMessage`) passam
`skipEnabledCheck: true`, e o gate de `agent_off` em `runAgentTurn` só vale
sem essa marca.

Existe pelo mesmo motivo do `skipUsageCheck` ao lado: desligar o agente é
justamente o que se faz para mexer nele. Com o sandbox mudo, conferir uma
mudança de persona exigia religar a chave — ou seja, voltar a atender cliente
de verdade com a versão que ainda estava sendo ajustada, que é o oposto do
que a chave existe para permitir.

Só o teste ganha a exceção. As outras pausas continuam valendo lá dentro:
`agentPaused` (humano assumiu a conversa) é checado antes e cala o teste
também — um humano no comando de uma conversa é um fato sobre aquela
conversa, não sobre o canal.

#### Escrever dos dois lados dentro da conversa de teste

Numa conversa com `isTest: true`, a caixa de resposta de `/conversas` ganha um
seletor de lado (`SendMessageForm`, `SegmentedControl` "você | cliente"):

O modo inicial é **cliente** em cada conversa de teste aberta. A escolha manual
vale durante aquela abertura; trocar de conversa remonta o formulário pelo ID.
Conversas reais continuam iniciando como **você**.

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
relatórios. Usa `skipUsageCheck: true` e `skipEnabledCheck: true` pelo mesmo
motivo do `/api/sandbox` — teste não é atendimento.

O `status` do turno volta para a interface e vira aviso quando o agente fica
calado (`human_handling` = pausado nesta conversa, `no_agent`,
`limit_reached`). Sem isso, escrever como cliente e não ver resposta parecia
bug, sendo que cada um desses silêncios é o comportamento correto — só que por
uma causa diferente. `agent_off` não chega por aqui: o teste responde com a
chave geral desligada (ver abaixo).

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
`Agent.enabled` (`agent_off`), que é a chave geral e cala o agente em todas as
conversas de cliente — mas não no chat de teste (`skipEnabledCheck`).
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

### Transferir para humano e o grupo do WhatsApp (`handoff.ts`)

Uma conversa vira "precisa de você" por **dois caminhos**, e os dois são a
mesma coisa para quem está do outro lado:

| caminho | onde | o que marca |
| --- | --- | --- |
| tool `handoff_human` | `tools.ts` (o LLM decide) | `needsHuman` |
| reação do atendente pelo número da empresa | webhook do WhatsApp | `needsHuman` + `agentPaused` |

O segundo depende de `Agent.stopOnEmoji`, que **nasce ligado** (`@default(true)`
no schema): reagir com emoji é o gesto mais barato para o atendente avisar
"assumi esta conversa". O webhook distingue a origem por `isFromMe`: reação do
cliente e mensagem que contém apenas emoji não pausam o agente.

**A config da ação vive em `TenantAction.config`** (chave `handoff_human`),
mesmo padrão de `follow-up/config.ts` e `scheduling/config.ts` — por agente,
sem coluna nova. Ela guarda o grupo e quando mandar para ele:

```ts
type HandoffConfig = {
  addToGroup: boolean;
  groupId: string | null;   // JID "...@g.us" — é o que vale
  groupName: string | null; // só exibição (card fechado, grupo que sumiu da lista)
  groupReason: string;      // "quando mandar para este grupo", nas palavras do dono
}
```

**O grupo é escolhido numa lista**, não colado: `listWhatsAppGroups(tenantId)`
pergunta à Evolution (`GET /group/fetchAllGroups?getParticipants=false`) de
quais grupos o número conectado participa. A tela busca **sob demanda**, só
com a opção de grupo ligada — numa conta com muitos grupos a Evolution leva
segundos. A lista é conveniência, não requisito, e a função **nunca lança**:

| resultado | a tela mostra |
| --- | --- |
| lista | `SelectMenu` com os grupos + "Atualizar lista" |
| lista vazia | como criar o grupo (este número como admin) + "Atualizar lista" |
| `disconnected` / `failed` | aviso + "Tentar de novo" + campo para colar o ID, como antes |
| `unsupported` (Meta) | só o aviso: a Cloud API não tem grupos, colar o ID não adiantaria |

O grupo salvo que não aparece mais na lista (o número saiu dele) continua como
opção marcada "não encontrado": sem isso o menu cairia em "Escolha um grupo" e
o próximo salvar apagaria a escolha sem ninguém pedir. O número conectado
precisa ser **administrador** do grupo, senão o WhatsApp recusa o convite — a
lista não filtra por isso (exigiria buscar os participantes de todos os
grupos), a dica do campo avisa.

**O motivo vira a descrição da tool.** `handoffToolDescription(cfg)` acrescenta
"Use sempre que: <motivo>" à descrição de `handoff_human`, e é por ela que o
agente fica sabendo quando transferir e mandar para o grupo — antes isso
dependia de alguém repetir a regra na persona. "Sempre que", não "só quando":
o motivo acrescenta um gatilho sem proibir os outros (quem pede para falar com
uma pessoa continua sendo transferido). Vale só com o grupo ligado, porque o
campo mora dentro dessa opção; desligada, o texto fica guardado e sem efeito.
Em branco, a descrição é a de sempre. A reação do atendente (o outro caminho
da tabela acima) não passa pelo LLM e adiciona ao grupo independentemente do
motivo — ali quem decidiu foi uma pessoa.

Ligado, `addLeadToHandoffGroup` adiciona o telefone do contato a um **grupo
fixo** do WhatsApp — normalmente o grupo onde a equipe de atendimento já está.
É um grupo por agente, não um grupo novo por atendimento: criar e limpar um
grupo por lead exigiria cadastro de atendentes e uma política de descarte que
ninguém pediu.

Regras que não são óbvias:

- **`addToGroup` nunca fica ligado sem `groupId`.** `parseHandoffConfig` força
  isso na leitura e o formulário recusa no envio (`superRefine` **antes** do
  `transform` — depois, o ID inválido já teria virado `addToGroup: false` e a
  tela diria "salvo" com a opção silenciosamente desligada). Um toggle ligado
  que não faz nada faz a tela mentir, igual à regra de `speakReplies` sem voz.
- **Desligar a opção não apaga o grupo nem o motivo.** Os campos ficam
  escondidos, não desmontados, e continuam no envio — e o schema da action
  grava o `groupId` mesmo com a opção desligada (antes o `transform` o zerava,
  e o campo escondido não servia de nada). Desligar é pausar, não descadastrar
  (mesma distinção de desabilitar × desconectar em `/integracoes`).
- **A ação desligada não adiciona ninguém.** Quem age lê por
  `getActiveHandoffConfig`, que checa `TenantAction.enabled`; `getHandoffConfig`
  (sem a checagem) é só para a tela preencher o formulário, porque desligar a
  ação não pode apagar o que foi configurado.
- **Conversa de teste fica de fora** (`isTest`). O sandbox usa telefone
  sintético, e ele no grupo real polui o grupo da equipe com um número que não
  existe — mesma regra do worker de follow-up e do envio de resposta.
- **Nunca lança, e o `try` cobre o banco também**, não só a chamada de rede.
  No webhook, uma exceção escapando viraria 500 e a Evolution reentregaria a
  mesma mensagem em laço. A transferência já aconteceu; o grupo é o extra.
- **O ID colado à mão aceita as duas formas** que a pessoa consegue copiar:
  `120363...@g.us` ou só os dígitos (`normalizeGroupId` completa o sufixo).
  Um telefone de pessoa (`@s.whatsapp.net`) é recusado.

Envio: `WhatsAppProvider.addParticipantToGroup` →
`POST /group/updateParticipant?groupJid=...` com `action: "add"` na Evolution.
Regressões em `tests/handoff-grupo.test.ts` (banco e provider simulados).

Na conexão oficial da Meta este extra não existe: a Cloud API não expõe gestão
de participantes de grupos. A transferência principal (`needsHuman`) continua
normal e `addLeadToHandoffGroup` engole a limitação como qualquer falha do extra;
para adicionar ao grupo é necessário usar Evolution.

O número precisa estar **conectado** (`WhatsappInstance.status`): sem sessão
ativa não há de onde convidar. O WhatsApp também recusa o convite direto quando
a pessoa restringe quem pode adicioná-la a grupos — nesse caso a Evolution
devolve erro, ele fica no log e a transferência segue normal.

### Triagem de contatos (`disqualify.ts`, tool `disqualify_lead`)

A ação **"Triagem de contatos"** deixa o agente encerrar sozinho quem não é
cliente em potencial — vendedor, parceria, currículo, trote, engano, fora da
área atendida. Sem ela, todo contato desses ou vira fila para uma pessoa ou
some sem registro.

**Desqualificado não é perdido.** `Lead.disqualifiedAt` é "nunca foi cliente";
`Lead.status: "lost"` é "era cliente e não fechou" (quis, sumiu, escolheu
outro). Contar os dois juntos apagaria exatamente o que a clínica quer ver.
Por isso o carimbo é um campo próprio e não um status novo.

**O carimbo é sempre explícito**, nunca inferido do texto da conversa: ele vira
dinheiro na visão Financeira de /relatorios, e um palpite ali é um número que
o cliente confere contra a própria folha de pagamento e não bate.

Três detalhes do handler que não são acidentais:

- **`updateMany` com `tenantId` no filtro**, não `update` por id cru — o id vem
  do contexto do turno, e escrever por id sem o tenant é o tipo de caminho em
  que um id trocado atravessa conta sem ninguém perceber.
- **`disqualifiedAt: null` no filtro**: mantém o PRIMEIRO carimbo. O contato que
  volta e é desqualificado de novo não pode entrar no relatório de dois meses.
- **Não marca `needsHuman` e não encerra a conversa.** O ponto da triagem é
  justamente não ocupar uma pessoa; e se o contato responder de novo, o agente
  segue atendendo normalmente.

O motivo (`parseReason`) **nunca recusa** a desqualificação: valor fora da lista
vira `"outro"`. O valor está no carimbo, o motivo é o detalhe — perder a triagem
inteira porque o LLM inventou uma string seria trocar o dado pelo enfeite.

A conversão para tempo/dinheiro mora em `TenantAttendanceCost` (minutos por
atendimento × custo da hora), declarado pela clínica em /relatorios. Sem isso,
o relatório mostra só a contagem e convida a definir — nunca uma média do
sistema apresentada como fato.

### Duplicar, exportar, importar e replicar agentes

O formato portátil mora em `agent-package.ts`; leitura e criação ficam em
`transfer.ts`. O pacote `.fechai-agent.json` é versionado e contém persona,
prompt, comportamentos, ações com seus `config` e o texto integral dos
documentos do Cérebro.

Ao criar uma cópia, os documentos passam novamente por `ingestDocument`: os
chunks e embeddings precisam nascer com o novo `agentId`; copiar linhas cruas
misturaria o RAG dos agentes. A operação apaga a cópia incompleta se qualquer
etapa falhar.

Não entram conversas, contatos, agendamentos nem posição de agente principal.
A cópia sempre nasce desligada. Voz pronta do catálogo é portável; voz gravada
não é, porque compartilhar o mesmo modelo faria excluir/regravar em um agente
quebrar o outro e transferiria uma voz pessoal para outra empresa.

O cliente duplica e exporta em `/agentes/[id]`, importa em `/agentes`. O
superadmin replica entre tenants em `/admin/agentes`; o limite de agentes e de
ações do plano de destino continua valendo.

## O que NÃO faz

- Não fala com o WhatsApp — quem envia é o `whatsapp` provider (chamado pelo webhook, ou por `sendManualMessage` numa resposta manual).
- Não dispara follow-up no tempo — isso é o worker (`workers/follow-up-worker/scan.ts`). A tool `follow_up` só registra como o contato deixou a conversa (`followUpReason`: não quer agendar agora, ou pediu para parar), que decide a esteira.
- Não resume conversa sozinho: `summarizeConversation` só roda quando alguém pede pela interface (ver seção acima).
- Não decide sozinho quanto vale o tempo economizado pela triagem: a régua (minutos e custo/hora) é declarada pelo dono da conta em /relatorios.
