# Scheduling — leituras

- `getScheduleConfig(agentId)`: agentId+chave, select config, parse; chamador valida ownership.
- `loadClinicorpReminderTypesAction()`: requireTenant+flag → nomes únicos, sem teto de 12; erro {ok:false,error}.
- `loadClinicorpDurationNamesAction()`: mesmo acesso, limite MAX_DURATIONS; não informa minutos.
- `listClinicorpCategories(tenantId)`: getIntegration → /appointment/list_categories; id/nome.
- `listClinicorpAgenda(tenantId,from,to,timezone,{fresh?})`: off/ok/error, ordenada, cache por período; worker fresh.
- `listMonthAppointments(tenantId,year,month,timezone)`: intervalo local, início crescente, agrupa dia; contato/agente.
- `hasConflictAnywhere(...)`: base local + Clinicorp; nunca considerar falha externa como agenda livre.
- `getCalendarFeatures(tenantId)`: flags, desligadas na ausência/falha.

Auditoria sem dados pessoais: tipo_excluido/tipo_desconhecido. Conferir categoria na resposta real antes de reativar: exemplo público não garante campos.
