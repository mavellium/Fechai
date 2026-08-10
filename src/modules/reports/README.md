# Módulo: reports

> Para a seção completa (página, componentes, regras, armadilhas e como estender), ver
> [`src/app/(dashboard)/relatorios/README.md`](../../app/(dashboard)/relatorios/README.md).

## O que faz

Calcula as métricas do tenant para `/relatorios` e a home. Só leitura, sempre filtrado por `tenantId` e por `isTest: false` (o sandbox não pode inflar os números).

## Arquivos

- `service.ts`:
  - `computeTenantReport(tenantId)` — totais desde o início da conta (legado).
  - `computeHomeSummary(tenantId, days)` — resumo da home com janela e comparação com o período anterior.
  - `resolveRange(period, de?, ate?)` — resolve a janela a partir da querystring (`?periodo=` ou `?de=&ate=`); devolve também a janela anterior (deltas) e a granularidade dos gráficos (`hora`/`dia`/`mes`).
  - `computePeriodReport(tenantId, range)` — KPIs com delta, séries de fluxo (recebidas × enviadas), resultados (leads × agendamentos), comparações IA × humano (`attendance`: contatos só com resposta da IA × com resposta humana; `closed`: agendamentos por `Appointment.source` agent × manual) e distribuições (por agente e por status).
  - `computeFinancialSummary(tenantId, range)` — visão Financeira: retorno estimado (agendamentos do período × valor por lead), investido (preço do plano atual × meses cobertos pela janela) e ROI. O valor por lead vem de `TenantLeadValue` (entradas com vigência: cada janela usa o valor em vigor no início dela — mudar o número não recalcula períodos passados).

## Contratos expostos

```ts
computeTenantReport(tenantId): Promise<TenantReport>
computeHomeSummary(tenantId, days): Promise<HomeSummary>
resolveRange(period, de?, ate?): ReportRange
computePeriodReport(tenantId, range): Promise<PeriodReport>
computeFinancialSummary(tenantId, range): Promise<FinancialSummary>
```

## O que NÃO faz

- Não faz cache — recalcula a cada carga da página.
- A visão Financeira é estimativa: não há histórico de assinatura no modelo (o investido presume o plano atual por todo o período) nem valor de lead automático.
- Gráficos são componentes locais em `/relatorios` (SVG/divs, sem biblioteca de charts).
