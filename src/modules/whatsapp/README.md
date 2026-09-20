# Módulo: whatsapp

## O que faz

Conecta o número de WhatsApp do tenant e troca mensagens atrás de uma interface
que isola o provedor. Cada conta escolhe entre **Evolution API self-hosted** e
**WhatsApp Cloud API oficial da Meta**; contas antigas continuam em Evolution.

## Arquivos

- `provider.ts` — interface `WhatsAppProvider` (`createInstance`, `getQrCode`, `sendMessage`, `parseWebhook`) e tipos (`IncomingMessage`, `WhatsAppStatus`).
- `evolution.ts` — `EvolutionProvider`: chama a Evolution API v2 (`/instance/create`, `/instance/connect`, `/message/sendText`) e faz parse do evento `messages.upsert`. `isConfigured()` = tem URL+key.
- `meta.ts` — `MetaCloudProvider`: Graph API oficial (texto, upload/download de
  áudio, perfil do número, inscrição do app no WABA e parse de webhook).
- `meta-config.ts` — resolve o adapter pela linha `WhatsappInstance`, decifra
  credenciais e valida `X-Hub-Signature-256` sem vazar segredo.
- `process-incoming.ts` — fluxo comum depois que cada webhook foi autenticado e
  normalizado: bloqueio, áudio, conversa, agente, voz e resposta.
- `index.ts` — factory dos adapters e nomes aceitos (`evolution | meta`).
- `blocklist.ts` — números que o agente ignora (`isPhoneBlocked`,
  `canonicalPhone`, `listBlockedNumbers`). Ver abaixo.
- `health.ts` — detecta número fora do ar (`checkTenantWhatsapp`, `scanWhatsappHealth`, `diagnose`) e sincroniza `WhatsappInstance.status` com a realidade.

## Contratos expostos

```ts
getWhatsAppProvider(name, credentials?): WhatsAppProvider
getWhatsAppProviderForInstance(instance): WhatsAppProvider
createInstance(tenantId) -> { externalId, status, qrCode? }
getQrCode(externalId) -> { status, qrCode? }        // GERA um QR (gasta QRCODE_LIMIT)
getConnectionState(externalId) -> { status, exists, reachable }  // só LÊ, nunca gera
sendMessage(externalId, toPhone, text)
disconnect(externalId)
ensureWebhook(externalId) -> boolean   // false = sem URL/segredo para apontar
parseWebhook(payload) -> IncomingMessage | null
```

## Seleção por conta e credenciais da Meta

`Tenant.metaWhatsappEnabled` nasce `false` e só o superadmin altera em
`/admin/contas`. Sem essa liberação a alternativa Meta não aparece em
`/integracoes`, as Server Actions recusam seleção/conexão direta e o webhook
oficial não aceita a conta. Desabilitar enquanto Meta está em uso volta a linha
para Evolution desconectada, mas preserva as credenciais cifradas.

`WhatsappInstance.provider` nasce como `evolution`, portanto o `db push` não
muda nenhuma conta existente. Para Meta, `externalId` é o **Phone Number ID** e
os demais dados ficam na mesma linha:

- Phone Number ID, WABA ID e telefone de exibição podem ficar legíveis;
- access token, App Secret e verify token são cifrados com AES-256-GCM usando
  `ENCRYPTION_KEY` (`meta*Encrypted`);
- credencial ilegível nunca vai crua/cifrada para um header: o adapter fica
  `isConfigured() === false` e a tela pede nova configuração.

A troca de provider só é permitida com o atual desconectado. Assim não ficam
Evolution e Meta processando o mesmo número em paralelo.

## Webhook oficial da Meta

Cada tenant recebe uma Callback URL própria:

`/api/webhooks/whatsapp/meta/{tenantId}`

O `GET` responde ao handshake somente se `hub.verify_token` bater, em tempo
constante, com o token aleatório cifrado da conta. O `POST` lê o corpo bruto e
valida `X-Hub-Signature-256` (HMAC-SHA256 com o App Secret) **antes** de fazer
parse ou chamar o motor. O `phone_number_id` do payload ainda precisa bater com
o salvo no tenant. Eventos de status (`sent`, `delivered`, `read`) são ignorados;
somente `messages` entra no atendimento.

No painel da Meta é obrigatório assinar o campo `messages`. A action também
tenta `POST /{WABA-ID}/subscribed_apps`, mas mantém as credenciais válidas e
mostra um aviso se o token não tiver permissão para fazer essa inscrição.

### Diferenças funcionais da API oficial

- Não existe QR nem sessão de aparelho. Conectar valida Phone Number ID + token.
- A Cloud API oficial não gerencia participantes de grupos. A transferência
  para humano continua marcando a conversa, mas o extra "adicionar ao grupo"
  só funciona com Evolution.
- Texto livre obedece à janela de atendimento aberta pelo cliente. Fora dela a
  Meta exige template aprovado; follow-ups e lembretes em texto livre podem ser
  recusados. A tela avisa isso sem fingir paridade que a própria Meta não oferece.
- Desconectar no fechai é local: não desregistra o telefone do WABA. O webhook
  passa a ignorar a linha e as credenciais ficam preservadas para reconexão.

## Webhook Evolution: por instância, nunca global

O webhook do fechai (`api/webhooks/whatsapp`) **recusa com 401 tudo que não trouxer
o header `x-webhook-secret`** — identificador de instância é identificador, não
credencial. O webhook **global** da Evolution (`WEBHOOK_GLOBAL_*` no compose)
**não sabe mandar header nenhum**: o tipo dela só tem URL, ENABLED e
WEBHOOK_BY_EVENTS; `headers` existe apenas na configuração **por instância**.

Ligar o global, portanto, é o pior dos mundos: o número aparece conectado na
tela e **nenhuma mensagem entra**, porque cada evento toma 401 — e 401 está na
lista de status que a Evolution considera definitivos (`400, 401, 403, 404,
422`), então ela **descarta** em vez de reentregar. Não há fila para recuperar
depois. Foi exatamente esse o sintoma de "0 mensagens recebidas nos últimos 7
dias" com o WhatsApp conectado.

Por isso o compose mantém `WEBHOOK_GLOBAL_ENABLED: "false"` fixo e **quem
configura o webhook é o app**:

- `createInstance()` manda o bloco `webhook` no próprio `/instance/create` —
  instância nasce entregando.
- `ensureWebhook(externalId)` (`POST /webhook/set/{instance}`) reaponta uma
  instância existente. `connectWhatsapp()` a chama a cada conexão (idempotente,
  e **não derruba a conexão se falhar** — o número conectado é o que o cliente
  veio buscar).
- `npm run whatsapp:webhooks` conserta em lote quem já está conectado e não tem
  motivo para clicar em "Conectar" de novo.

Precisa de `EVOLUTION_WEBHOOK_URL` (a URL pública do `/api/webhooks/whatsapp`) e
`WHATSAPP_WEBHOOK_SECRET` no `.env` do **app**. Sem um dos dois,
`webhookConfig()` devolve `null` e a instância é criada **sem** webhook — o
produto funciona, só não recebe — em vez de entregar sem o header e tomar 401 em
silêncio.

## O QR gira — e a sessão tem contador

Dois detalhes que, juntos, produzem "não foi possível conectar o dispositivo,
tente novamente mais tarde" **no celular**, com a tela do painel mostrando um
código de aparência perfeita:

1. **O WhatsApp troca o QR a cada ~20s** e invalida o anterior na hora. A
   Evolution não devolve a expiração, então `WhatsappConnect.tsx` conta sozinho
   (`QR_TTL_S`) — e, a cada poll, **substitui a imagem** pelo código que veio na
   resposta de `refreshWhatsappStatus()`. Ignorar esse `qrCode` (o que a tela
   fazia) é reexibir um código morto com o contador ainda correndo.
2. **A Evolution corta a sessão em `QRCODE_LIMIT` QRs gerados** (30 por padrão):
   manda `state: "refused"` e passa a recusar toda leitura. O contador só zera
   com um logout de verdade. Por isso `connectWhatsapp()` desloga antes de pedir
   o código — **só quando a instância não está `connected`**, porque deslogar um
   número que está atendendo derruba o atendimento para gerar um QR que ninguém
   pediu. O logout falhando não impede o QR: sessão já limpa devolve erro, e é
   exatamente o estado que queríamos.

## Bloqueio de número: comparar é o problema, não a lista

Guardar uma lista de telefones é fácil; **casar duas escritas do mesmo número**
é onde isso quebra. O dono digita `(11) 98765-4321` na tela e o WhatsApp
entrega `5511987654321` no `remoteJid` — e o mesmo aparelho ainda chega como
`551187654321` quando a origem não traz o nono dígito. Comparar string com
string daria o pior resultado possível: a tela listando "bloqueado" com o
agente respondendo normalmente, e ninguém desconfiando de um bloqueio que a
própria tela confirma.

Por isso tudo passa por `canonicalPhone()`: só dígitos, sem o `55` e **sem o
nono dígito** — DDD + 8 últimos. As três formas colidem de propósito. Número
estrangeiro passa inteiro: sem saber o país não dá para cortar sem risco de
bloquear outra pessoa. É a forma canônica que vai para a coluna
`WhatsappBlockedNumber.phone` (única por tenant), então a consulta do webhook é
um lookup por chave.

Tabela e não coluna Json no Tenant porque isso roda **a cada mensagem que
entra**; e não uma flag no `Lead` porque o caso comum é bloquear quem ainda
**não** escreveu (o ex-fornecedor, o número de spam que já incomodou o
vizinho) — esperar virar lead chegaria sempre tarde.

No webhook a checagem vem **antes** de tudo que custa ou grava: download e
transcrição de áudio, lead, conversa, turno de LLM. Um bloqueado que
continuasse aparecendo em Conversas e queimando cota seria um bloqueio de
mentira. Vale também para `isFromMe` — o dono respondendo à mão num chat
bloqueado não pode ressuscitar a conversa que o bloqueio existe para não ter.
Grupo não passa por aqui: tem dono próprio (`whatsappIgnoreGroups`) e JID de
grupo não é telefone.

Duas regras que os testes travam:

- **Ignorar é silêncio total.** Nada é respondido — nem um "não posso falar".
  Um aviso automático transformaria o bloqueio num convite a insistir.
- **`isPhoneBlocked` nunca lança e, na dúvida, deixa passar.** Banco fora do ar
  no webhook viraria 500 e a Evolution reentregaria em laço; e engolir a
  mensagem de um cliente real por causa de uma falha de leitura custa a venda,
  enquanto deixar passar um bloqueado é só incômodo.


## Verbos HTTP da Evolution v2

Cada rota tem o seu, e errar o verbo devolve um **404 genérico do Express** que
parece "instância não existe" — foi o que produzia `Evolution logout falhou
(404)` na tela. As que usamos:

| rota | verbo |
| --- | --- |
| `/instance/create` | POST |
| `/instance/connect/{id}` | GET |
| `/instance/logout/{id}` | **DELETE** |
| `/message/sendText/{id}`, `/message/sendWhatsAppAudio/{id}` | POST |
| `/chat/getBase64FromMediaMessage/{id}` | POST |
| `/group/updateParticipant/{id}?groupJid=` | POST |
| `/webhook/set/{id}` | POST |
| `/instance/connectionState/{id}` | GET |

## Status conectado é uma PERGUNTA, não uma lembrança

`WhatsappInstance.status` era gravado no momento da conexão e nunca mais
revisitado. Quando a sessão morria, ninguém reescrevia o campo: o painel seguia
mostrando "Seu número está atendendo · conectado" por dias, o cliente achava que
estava sendo atendido e os leads caíam no vácuo. Um incidente real só foi
descoberto porque um humano estranhou o silêncio — **horas** depois, com
mensagens perdidas (a Evolution nem chegou a recebê-las: não há o que
reprocessar).

`health.ts` conserta isso em duas frentes, e **as duas são necessárias**:

1. **Estado no provedor** (`getConnectionState`) — pega a sessão derrubada, que
   é o caso comum, e sincroniza o campo do banco.
2. **Silêncio** (`Conversation.lastInboundAt`) — pega o caso que o estado não
   pega. No incidente, a Evolution respondeu `state: "open"` enquanto o
   `logout` da mesma instância, no mesmo segundo, devolvia `"Connection
   Closed"`. **O provedor mente**; o fluxo de mensagens, não. Número
   "conectado" mudo há 6h+ em horário comercial é suspeito até prova em
   contrário.

Três cuidados que o código protege (e os testes travam):

- **`reachable: false` nunca vira alerta.** Evolution fora do ar é problema
  nosso — avisar "seu número caiu" nesse caso é mentir para o cliente e ainda
  provocar uma reconexão desnecessária.
- **Alarme falso corrói o alerta verdadeiro.** Por isso o silêncio só conta em
  horário comercial, com folga de 6h, e há cooldown de 12h por conta
  (`Tenant.whatsappHealthAlertAt`) — sem ele, cada varredura do worker mandaria
  outro e-mail até alguém reconectar.
- **`getConnectionState` nunca gera QR.** `getQrCode` chama
  `/instance/connect`, que **cria um QR a cada chamada** e gasta o
  `QRCODE_LIMIT` (30); usá-lo para monitorar em laço deixaria a instância
  `refused`, recusando a leitura justamente quando alguém fosse religar.

A varredura roda no worker (`workers/follow-up-worker`), junto com follow-up e
lembretes: precisa acontecer mesmo quando **ninguém abre o painel** — o modo de
falha que ela existe para pegar é exatamente o silêncio que ninguém vê.

`connectWhatsapp()` também consulta o estado vivo antes de decidir: instância
apagada no provedor (`exists: false`) é **recriada** em vez de receber um pedido
de QR que devolveria 404 — antes, o botão "Conectar" falhava justamente quando
era a única coisa que resolveria.

## O que NÃO faz

- Não decide a resposta — isso é do `agent-engine` (orquestrador).
- Não persiste conversas/leads — quem grava é o orquestrador.
- `onMessageReceived` é feito via webhook (`api/webhooks/whatsapp`), não por polling.
