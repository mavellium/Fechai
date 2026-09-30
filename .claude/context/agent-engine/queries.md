# Agent-engine — Leituras

- `getRecentMessages(conversationId, limit=10)`: `{ role, content, createdAt }[]`, cronológico (busca desc + reverse).
- `resolveAgent(tenantId, agentId?)`: sem id, o principal (`isPrimary desc, createdAt asc`).
- `getOrCreateConversation(tenantId, phone, name?, { isTest? })`: `{ lead, conversation }`.
- `leadAppointmentsContext(ctx, cfg, now?)`: consultas futuras `scheduled` do lead; cada uma com dia relativo ("é HOJE, às 10:45"). Também é a saída da tool `list_appointments`. Só ID e horário, nada de título/nota.
- `availableSlotsContext(ctx, cfg, date, days?, excludeDates?, excludeWeekdays?)`: até 5 datas livres em 14 dias.
- `loadConversationVariables(tenantId, conversationId)`.
- `getHandoffConfig(agentId)` só para a tela; quem age usa `getActiveHandoffConfig(tenantId, agentId)` (privada em `handoff.ts`, exige ação `enabled`).
- `listWhatsAppGroups(tenantId)`: nunca lança.
- `getToolSchemas(keys, scheduleConfig?, variableDefs?, handoff?)`: schemas das ações ativas.
- `getAgentUsage`, `listAgents`, `getAgentOwned`.

Tenant em toda consulta.
