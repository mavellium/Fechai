# Scheduling

Agenda do fechai, espelhos Google/Clinicorp e lembretes por tipo de consulta.

| Área | Fonte |
| --- | --- |
| Domínio | `src/modules/scheduling/config.ts`, `reminder-override.ts` |
| Escrita | `repository.ts`; actions em `src/app/(dashboard)/agentes/actions.ts` |
| Leitura | `repository.ts`, `clinicorp.ts`, `features.ts` |
| Envio | `workers/follow-up-worker/{reminders,clinicorp-reminders}.ts` |

[Domínio](domain.md) · [Actions](actions.md) · [Queries](queries.md) ·
[Padrões](patterns.md) · [Histórico](changelog.md).

Antes de usar:
- Confira `src/modules/scheduling/README.md`.
- Tenant em toda consulta; datas em `time.ts`.
- Agenda local é a verdade; falha do espelho não apaga reserva.
- Público escolhido vale nas duas filas, inclusive overrides.
- Sem categoria identificada, público restrito não envia.
