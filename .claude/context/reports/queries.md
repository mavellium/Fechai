# reports — Queries

## computeMonthlyReport(tenantId, month, useSnapshot = true, previewAssumptions?) → MonthlyReport
- `ready` + snapshot → devolve o snapshot. Senão lê conversas/agendamentos/eventos/gaps do mês e do anterior, Clinicorp e `loadLeadQualityDetail`, calcula, aplica correções e anexa `evidence` + `quality` + `limitations`.

## evaluateMonthlyMetrics(input) → { metrics, evidence } (puro)
- Única fonte dos números e dos registros; `calculateMonthlyMetrics(input)` = `.metrics`.

## monthlyQuality(report) → MonthlyQuality (puro)
- Compara `current` com `automatic.current`; lê `assumptions`, `clinicorpError`, `investmentSource`, `leadQuality`, `evidence`.

## executiveSummary(report) / monthlyIncidents(report) / monthlyFinancial(report) (puros, `monthly-executive.ts`)
- `lede`, 4 KPIs (contatos, agendadas = âncora, compareceram, 1ª resposta do agente), linhas das partes, `tables` (time, arrivals, reception, funnel, outcome, procedures, doubts, reasons), `previousActions`, `caseItems`, `unplanned { note, incidents, limitations, none }`; bloco financeiro ou `null`.
- `monthlyIncidents`: faltas, quedas e espera da recepção comprovadas; vazio + sem nota/limitação = `NO_INCIDENT`.

## loadApprovedReport(tenantId, month) → MonthlyReport | null (`monthly.ts`)
- Só o snapshot `ready` válido; é o que o PDF da clínica usa. Nunca recalcula.

## approvedDocument(report) → MonthlyDocument (puro, `monthly-document.ts`)
- Tira `evidence`, `automatic`, `metricOverrides` (fica `manualAdjustments` + horas manuais), `revision`, origem da mensalidade, status crus do Clinicorp e a conversa do caso. `generateMonthlyPdf` chama antes de desenhar.

## loadMonthlyCaseFacts(tenantId, month, config, conversationId, age) → CaseFacts | null
- Áudios longos ouvidos, dia da semana, período e se agendou, lidos da conversa (tenant + mês + agentes). `null` = conversa inválida.

## monthly-operations.ts (puro)
- `arrivalSlot(at, config)`, `availabilityMetrics({ start, end, now, trackedSince, incidents, inbound })` (`null` = não medido), `median`.

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
- `generateMonthlyPdf(report)`: A4 no modelo revisado, tudo flui (sem página 1 fixa): abertura + 4 números, partes 01–06, retorno estimado opcional e "Como contamos" em página nova; etiqueta "ESTIMATIVA" só no estimado; rodapé com a versão aprovada e "Página X de N"; nunca registros. Rota admin `?ver=1` = inline (prévia, com "RASCUNHO · NÃO APROVADO").
