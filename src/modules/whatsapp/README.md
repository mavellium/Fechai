# Módulo: whatsapp

## O que faz

Conecta o número de WhatsApp do tenant e troca mensagens, atrás de uma interface que isola o provedor (hoje Evolution API self-hosted).

## Arquivos

- `provider.ts` — interface `WhatsAppProvider` (`createInstance`, `getQrCode`, `sendMessage`, `parseWebhook`) e tipos (`IncomingMessage`, `WhatsAppStatus`).
- `evolution.ts` — `EvolutionProvider`: chama a Evolution API v2 (`/instance/create`, `/instance/connect`, `/message/sendText`) e faz parse do evento `messages.upsert`. `isConfigured()` = tem URL+key.
- `index.ts` — `getWhatsAppProvider()` (factory). Trocar de provedor acontece só aqui.

## Contratos expostos

```ts
getWhatsAppProvider(): WhatsAppProvider
createInstance(tenantId) -> { externalId, status, qrCode? }
getQrCode(externalId) -> { status, qrCode? }
sendMessage(externalId, toPhone, text)
disconnect(externalId)
ensureWebhook(externalId) -> boolean   // false = sem URL/segredo para apontar
parseWebhook(payload) -> IncomingMessage | null
```

## Webhook: por instância, nunca global

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

## O que NÃO faz

- Não decide a resposta — isso é do `agent-engine` (orquestrador).
- Não persiste conversas/leads — quem grava é o orquestrador.
- `onMessageReceived` é feito via webhook (`api/webhooks/whatsapp`), não por polling.
