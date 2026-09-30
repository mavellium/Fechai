# Agent-engine — Histórico

**Instrução:** Atualize aqui cada vez que mexer neste módulo.

### 2026-09-30 — Datas relativas e histórico de outro dia

Arquivos: `time-context.ts` (novo), `orchestrator.ts`, `scheduling-tools.ts`, `conversation.ts`, `follow-up/compose.ts`, `follow-up-worker/scan.ts`, `tests/contexto-data.test.ts`, README.

Razão: agente repetiu "amanhã às 10:45" do lembrete da véspera no dia da consulta (Instituto do Sorriso).

Impacto: data de agora em todo turno; consultas com dia relativo calculado; follow-up com IA recebe transcrição datada. Sem schema novo.

### 2026-09-30 — Documentação inicial

Razão: economizar tokens em futuras sessões.
