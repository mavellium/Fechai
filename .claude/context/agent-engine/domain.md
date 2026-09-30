# Agent-engine — Domínio

## Turno (`orchestrator.ts`)
- `TurnStatus`: `ok | agent_off | human_handling | no_agent | limit_reached`.
- `AgentTurn`: `{ reply, toolsUsed, status, replyMessageId? }`.
- Ordem: grava msg do contato → `agentPaused` → cota (`atLimit`, pula no sandbox) → agente ligado (sandbox pula) → prompt → loop.
- `MAX_TOOL_ITERATIONS = 3`; última volta força texto sem tools.
- Histórico: `getRecentMessages(conversationId, 10)` com `createdAt`.

## Montagem do system prompt (ordem)
persona → estilo de fala (só áudio) → `conversationTimeContext` → `scheduleSystemContext` → `leadAppointmentsContext` → variáveis → RAG → `unansweredRule` → `leadInsightRule` → `INJECTION_GUARD`.

## ToolContext (`tools.ts`)
`{ tenantId, leadId, conversationId, agentId, replyOverride? }` — `replyOverride` encerra o turno com texto seguro.

## Tools expostas
`register_lead`, `mark_hot_lead`, `schedule_meeting`, `list_available_slots`, `list_appointments`, `cancel_meeting`, `reschedule_meeting`, `follow_up`, `handoff_human`, `disqualify_lead`, `report_unanswered`, `remember_variables`; `record_lead_insight` vem de `lead-insights/tool.ts`. Só as ativas no agente.

## Tempo (`time-context.ts`)
- `DEFAULT_AGENT_TIMEZONE = "America/Sao_Paulo"` (sem agenda configurada).
- `relativeDayLabel(target, now, tz)`: hoje/amanhã/depois de amanhã/ontem/anteontem ou "sexta-feira, 02/10". Dias de calendário no fuso, não 24h.
- `conversationTimeContext({ now, timeZone, history })`: data de agora + regra + fronteira de dias do histórico. Só cita texto do próprio agente.
- `transcriptStamp`: "hoje 08:38" / "ontem 20:24" / "25/09 14:10" — só para transcrição em mensagem única.

## Invariantes
- `parse*` de config nunca lança.
- Aviso de fronteira vai no system prompt, não como `system` no histórico (Gemini funde).
- Nada de prefixo de data no conteúdo das mensagens do agente.
- Um `now` por turno.
