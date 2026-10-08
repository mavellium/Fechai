# Bitrix24

Fechai → CRM/reuniões Bitrix24 Cloud por conta, em Integrações → CRM.

| Área | Fonte |
| --- | --- |
| Domínio | schema Prisma; mirror.ts |
| Actions | `src/app/(dashboard)/integracoes/bitrix-actions.ts` |
| Leitura/conexão | integration.ts; client.ts |
| Fila | worker.ts; worker existente |

[Domínio](domain.md) · [Actions](actions.md) · [Queries](queries.md) · [Padrões](patterns.md) · [Histórico](changelog.md).

Antes de alterar:

- Leia `src/modules/bitrix/README.md` para contratos REST e limites.
- Tenant/destino em toda operação; webhook cifrado, nunca no cliente.
- Agenda local é a verdade; testes ficam fora; não há importação.
- Criação incerta só reconcilia; nunca repetir POST automaticamente.
- Schema exige `db push` + `generate` em web e worker.
