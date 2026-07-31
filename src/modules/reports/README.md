# Módulo: reports

## O que faz

Calcula as métricas do tenant para a tela `/relatorios`. Só leitura, sempre filtrado por `tenantId`.

## Arquivos

- `service.ts` — `computeTenantReport(tenantId)` retorna `TenantReport`:
  - `conversations`, `leads`, `hotLeads`, `scheduled`, `needsHuman`, `followUpsSent`
  - `responseRate` (0..1) — proporção de conversas "engajadas" (lead com 2+ mensagens).

## Contratos expostos

```ts
computeTenantReport(tenantId): Promise<TenantReport>
```

## O que NÃO faz

- Não agrega séries temporais / gráficos (só totais no MVP).
- Não faz cache — recalcula a cada carga da página.
