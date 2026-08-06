# Worker: follow-up-worker

## O que faz

Processo separado (BullMQ + Redis) que, periodicamente, encontra conversas sem resposta do lead e dispara um follow-up automático — para tenants com a ação `follow_up` ativa.

## Arquivos

- `scan.ts` — lógica de negócio (testável):
  - `isEligible(conv, cutoff)` — regra pura: não `needsHuman`, sem `followUpSentAt`, `lastInboundAt` antigo, última msg do agente.
  - `scanAndSendFollowUps(now?)` — varre elegíveis, envia via WhatsApp (se conectado), grava a mensagem e marca `followUpSentAt`. Retorna `{ scanned, sent }`.
- `index.ts` — cria a Queue, agenda o job repetível `scan` (`upsertJobScheduler`) e roda o `Worker`.

## Como rodar

```bash
npm run db:up        # Redis precisa estar de pé
npm run worker       # tsx workers/follow-up-worker/index.ts
```

Env: `REDIS_URL`, `FOLLOWUP_SCAN_EVERY_MINUTES` (intervalo da varredura, padrão 15).

O silêncio até o follow-up e o texto da mensagem são configurados por agente
(não são mais env/constante global) — `TenantAction.config` da chave
`follow_up`, editado em `/agentes/[id]` → Ações → Follow-up automático (ver
`src/modules/follow-up/config.ts`). Padrão: 24h, mensagem genérica de reengajamento.

## O que NÃO faz

- Não gera texto por IA (usa o texto fixo salvo na config, não um LLM).
- Não reenvia mais de uma vez (marca `followUpSentAt`).
- Não roda dentro do Next — é um processo à parte (deploy no Railway/Fly.io).
