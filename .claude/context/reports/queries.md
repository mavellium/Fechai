# reports — Queries

## computeMonthlyReport(tenantId, month, useSnapshot = true, previewAssumptions?) → MonthlyReport
- `ready` + snapshot → devolve o snapshot. Senão lê conversas/agendamentos/eventos/gaps do mês e do anterior, Clinicorp e `loadLeadQualityDetail`, calcula, aplica correções e anexa `evidence` + `quality` + `limitations`.

## evaluateMonthlyMetrics(input) → { metrics, evidence } (puro)
- Única fonte dos números e dos registros; `calculateMonthlyMetrics(input)` = `.metrics`.

## monthlyQuality(report) → MonthlyQuality (puro)
- Compara `current` com `automatic.current`; lê `assumptions`, `clinicorpError`, `investmentSource`, `leadQuality`, `evidence`.

## monthlyLimitations(report) / unverifiedMetrics(report) (puros)
- Lista do que ficou sem evidência; nomes dos indicadores com selo `pending`.

## draftAnalysisBase(report, draft) (puro, `monthly-analysis.ts`)
- Números, selo e limitações do rascunho **não salvo**; usado na etapa 3 ("Recalcular") e na análise da IA.

## createMonthlyAiToolbox({ tenantId, report, agents }) (`monthly-ai-tools.ts`)
- `run(name, args)` → JSON; `consulted`; `reviewRows(ids)` filtra ids não devolvidos. `get_conversation` só com id dos registros + `tenantId`.

## calculateTimeMetrics(input, evidence?) (puro, `monthly-time.ts`)
- Áudio/texto respondidos pelo agente e duração dos atendimentos; com `evidence`, anota mensagens e exclusões.

## Outras
- `publishedMonthlyMonths(tenantId)`, `selectPublishedMonth(months, requested)`: competências `ready`.
- `loadMonthlyCaseCandidates(tenantId, month, config)`: sugestões do caso do mês (só admin, fora do snapshot).
- `loadAppointmentOriginHours(tenantId, appointments)`: dentro/fora para a `/agenda`; nunca lança.
- `service.ts`: `resolveRange`, `computePeriodReport`, `computeFinancialSummary`, `computeHomeSummary`, `computeTenantReport`.
- `generateMonthlyPdf(report)`: A4, selo por linha, legenda no rodapé; página 1 = resumo executivo (`highlights` + `nextActions`), depois análise detalhada que flui (funil, premissas, cobertura + limitações, metodologia); "Página X de N" no fim; nunca registros. Rota admin `?ver=1` = inline (prévia).
