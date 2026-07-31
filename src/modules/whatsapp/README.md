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
parseWebhook(payload) -> IncomingMessage | null
```

## O que NÃO faz

- Não decide a resposta — isso é do `agent-engine` (orquestrador).
- Não persiste conversas/leads — quem grava é o orquestrador.
- `onMessageReceived` é feito via webhook (`api/webhooks/whatsapp`), não por polling.
