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

`FollowUpConfig.delayMinutes` é guardado em **minutos**, não horas — a tela
deixa escolher a unidade (minutos ou horas) porque um follow-up de vendas
rápidas às vezes precisa de "15 minutos", não "1 hora" arredondado para cima.
O campo guarda o total em minutos e a unidade é só como a pessoa digita: ao
reabrir, o formulário mostra horas quando o valor é hora cheia (24h é mais
legível que 1440) e minutos quando não é.

**Configs antigas continuam valendo.** Antes o campo era `delayHours`, e toda
conta com follow-up ligado tem um no banco. `parseFollowUpConfig` lê os dois e
converte na leitura (`delayHours: 24` → `1440`), dando preferência a
`delayMinutes` quando ambos existem. Não houve migração de dados: a linha só é
reescrita quando alguém salva o formulário. **Não remova esse fallback** sem
antes migrar as linhas existentes — sem ele, todo intervalo escolhido volta
silenciosamente para o padrão de 24h.

Um intervalo configurado abaixo de `FOLLOWUP_SCAN_EVERY_MINUTES` dispara no
próximo ciclo de varredura, não no minuto exato — a cadência do scan é o
retardo mínimo real, então diminuir o intervalo configurado só ajuda até esse
teto. Teto do próprio intervalo: `MAX_FOLLOWUP_DELAY_MINUTES` (30 dias).

Regressões da conversão em `tests/follow-up-intervalo.test.ts`.

## O que NÃO faz

- Não gera texto por IA (usa o texto fixo salvo na config, não um LLM).
- Não reenvia mais de uma vez (marca `followUpSentAt`).
- Não roda dentro do Next — é um processo à parte (deploy no Railway/Fly.io).
