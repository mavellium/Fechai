# Scheduling — padrões

Leitura de configuração (`repository.ts`):
```ts
const action = await prisma.tenantAction.findUnique({
  where: { agentId_key: { agentId, key: "schedule_meeting" } },
  select: { config: true },
});
return parseScheduleConfig(action?.config);
```

Filtro antes de enviar, inclusive override (`workers/follow-up-worker/reminders.ts`):
```ts
if (!isReminderTypeAllowed(cfg, appt.serviceType)) continue;
```

`resolveScheduleServiceType` registra tipo; `resolveDuration` calcula minutos.

UI: SelectMenu multiple/array; preserve seleção ao carregar. Config em TenantAction; envio no worker.

Validar público, tenant, categoria ausente e envio incerto; tsc, lint, Vitest.
