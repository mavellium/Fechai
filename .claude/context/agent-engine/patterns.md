# Agent-engine — Padrões

## Bloco novo no system prompt
```ts
// orchestrator.ts — entra no array `systemPrompt`, filtrado por Boolean
const now = new Date(); // um só por turno
const timeContext = conversationTimeContext({
  now,
  timeZone: scheduleConfig?.timezone ?? DEFAULT_AGENT_TIMEZONE,
  history,
});
```

## Contexto que pode falhar
```ts
const appointmentsContext = scheduleConfig?.recognizeExisting
  ? await leadAppointmentsContext({ tenantId, leadId }, scheduleConfig, now).catch((err) => {
      console.error("[orchestrator] consulta da agenda falhou", err);
      return "Não foi possível consultar a agenda. ...";
    })
  : "";
```

## Transcrição para chamada de fundo (follow-up/resumo)
```ts
// conversa inteira vira UMA mensagem de usuário; prefixo de data é seguro aqui
`[${transcriptStamp(m.createdAt, now, timeZone)}] ${m.role === "user" ? "Contato" : "Você"}: ${m.content}`
```

## Tool com saída segura
```ts
ctx.replyOverride = "Texto que vai ao contato se a ação falhar.";
return ctx.replyOverride;
```

## Teste
Mock `@/lib/prisma` com `vi.hoisted`; datas fixas em UTC e fuso `America/Sao_Paulo` (ver `tests/contexto-data.test.ts`).
