# Bitrix24 — domínio

## Prisma

- `BitrixIntegration`: PK tenantId; webhook cifrado/null, portalHost, connectionKey, revision, opções, crmMode, responsibleId, cursores, lastSyncAt. Trocar portal exige desconectar e novo connectionKey.
- `BitrixSyncJob`: único tenant/destino/kind/entityId; payload, fingerprint, state, attempts, nextAttemptAt, claim e IDs externos. Estados: queued/processing/retry/synced/skipped; uncertain: contact/crm/activity/null.
- `Lead.updatedAt` e índices por tenant/data/ID sustentam captura incremental.

## Contratos (`mirror.ts`)

LeadPayload: contato/status. AppointmentPayload: consulta/contato/datas ISO/notas. Links: IDs/uncertain. MirrorContext: escopo/opções/call/persist; contratos Zod em mirror.ts.

Contato encontrado por telefone é reutilizado sem sobrescrever campos. CRM clássico cria lead; simples cria negócio. Remarcação atualiza reunião; cancelamento identifica/encerra, preserva ID e notas. Calendário real exige conferência. Testes/sem contato não exportam.

`BitrixFailure(message, uncertain, retryAfter)` traz erro seguro e recuo, sem corpo remoto na tela.
