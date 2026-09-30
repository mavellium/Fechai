# reports — Histórico

**Instrução:** Atualize aqui cada vez que mexer neste módulo.

### [2026-09-30] — Documentação inicial + origem e selo de qualidade de cada número

**Arquivos:**
- `monthly-evidence.ts`, `monthly-quality.ts` (novos); `monthly.ts` (`evaluateMonthlyMetrics`, `evidence`/`quality` no relatório); `monthly-time.ts` (sink de mensagens); `monthly-pdf.ts` (coluna Qualidade, legenda no rodapé)
- `relatorios/MonthlyEvidence.tsx`, `EvidenceDialog.tsx`, `MonthlyView.tsx`; `ui/modal.tsx` (`size="full"`), `ui/stat.tsx` (`footer`)
- `lead-insights/queries.ts` (`loadLeadQualityDetail`); `tests/relatorio-mensal-registros.test.ts`

**Razão:** "10 agendamentos" com 1 sem horário e 8 sem tipo, sem evidência da composição.

**Impacto:** sem schema novo; snapshots antigos sem `evidence`/`quality` escondem selo e registros.
