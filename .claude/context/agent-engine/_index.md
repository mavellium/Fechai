# Agent-engine

Turno do agente de IA: monta o prompt (persona + agenda + variáveis + RAG +
regras), roda o loop de tools e grava a resposta.

| Área | Fonte |
| --- | --- |
| Turno | `orchestrator.ts` (`runAgentTurn`) |
| Tools | `tools.ts`, `scheduling-tools.ts`; catálogo em `actions.ts` |
| Conversa | `conversation.ts`, `summary.ts`, `variables.ts` |
| Prompt | `persona.ts`, `time-context.ts`, `injection-guard.ts`, `unanswered-rule.ts` |
| Handoff | `handoff.ts` |
| Actions (UI) | `src/app/(dashboard)/agentes/actions.ts`, `conversas/actions.ts` |

[Domínio](domain.md) · [Actions](actions.md) · [Queries](queries.md) ·
[Padrões](patterns.md) · [Histórico](changelog.md).

Antes de usar:
- Leia `src/modules/agent-engine/README.md`.
- Config de ação mora em `TenantAction.config` com `parse*` que nunca lança.
- Datas relativas: `time-context.ts`; nunca copiar "hoje/amanhã" do histórico.
- Texto do contato nunca entra no system prompt.
- Handoff avisa o grupo, nunca adiciona o lead.
