# reports — Queries

## computeMonthlyReport(tenantId, month, useSnapshot = true, previewAssumptions?) → MonthlyReport
- `ready` + snapshot → devolve o snapshot. Senão lê conversas/agendamentos/eventos/gaps do mês e do anterior, Clinicorp e `loadLeadQualityDetail`, calcula, aplica correções e anexa `evidence` + `quality`.

## evaluateMonthlyMetrics(input) → { metrics, evidence } (puro)
- Única fonte dos números e dos registros; `calculateMonthlyMetrics(input)` = `.metrics`.

## monthlyQuality(report) → MonthlyQuality (puro)
- Compara `current` com `automatic.current`; lê `assumptions`, `clinicorpError`, `investmentSource`, `leadQuality`, `evidence`.

## calculateTimeMetrics(input, evidence?) (puro, `monthly-time.ts`)
- Áudio/texto respondidos pelo agente e duração dos atendimentos; com `evidence`, anota mensagens e exclusões.

## Outras
- `publishedMonthlyMonths(tenantId)`, `selectPublishedMonth(months, requested)`: competências `ready`.
- `loadMonthlyCaseCandidates(tenantId, month, config)`: sugestões do caso do mês (só admin, fora do snapshot).
- `loadAppointmentOriginHours(tenantId, appointments)`: dentro/fora para a `/agenda`; nunca lança.
- `service.ts`: `resolveRange`, `computePeriodReport`, `computeFinancialSummary`, `computeHomeSummary`, `computeTenantReport`.
- `generateMonthlyPdf(report)`: A4, selo por linha, legenda no rodapé; nunca registros.
