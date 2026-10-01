# reports — Histórico

**Instrução:** Atualize aqui cada vez que mexer neste módulo.

### [2026-10-01] — Modelo revisado: todos os leads, tudo que é mensurável

**Arquivos:** novos `monthly-operations.ts`, `monthly-previous-actions.ts`, `monthly-case.ts`, `monthly-document.ts`, `whatsapp/incidents.ts`; `monthly.ts` (recepção, chegadas, disponibilidade, agenda, `loadApprovedReport`, `loadMonthlyCaseFacts`), `monthly-executive.ts` e `monthly-pdf.ts` (reescritos), `monthly-quality.ts` (`showsSeal`, selos novos), `monthly-analysis.ts` (`monthlyAnalysisFacts`, `unbackedNumbers`), `monthly-time.ts` (`timeBreakdown`, `exactDateIn`), `lead-insights/summary.ts` (`notScheduled`); `actions.ts`, `MonthlyRoiEditor.tsx`, `MonthlyView.tsx`, `MonthlyEvidence.tsx`, rotas de PDF; `tests/relatorio-mensal-modelo-revisado.test.ts`

**Razão:** decisões do Vinícius (30/09): tudo que dá para medir aparece, todos os leads contam, regra conservadora só no retorno estimado.

**Impacto:** schema (`WhatsappIncident`, `Tenant.uptimeTrackedSince`, `MonthlyRoiReport.previousActions`/`caseFacts`) → `db push` + `generate` (web e worker); `hasUnplanned` e `UNPLANNED_ITEMS` removidos; `executiveSummary().unplanned` mudou de forma; fechar exige avaliar as ações do mês anterior e não exige mais texto na parte 05; disponibilidade só existe em meses medidos.

### [2026-10-01] — Decisor (dono) separado do contato operacional

**Arquivos:** `monthly-decision-maker.ts` (novo: `decisionMakerProblem`, `parseAccountOwners`, `ownersFromText`, `samePerson`); `monthly.ts` (`operationalContact?`); `actions.ts` (salvar/fechar/entrega); `MonthlyRoiEditor.tsx` (lista de donos, seletor do decisor, contato), `page.tsx` (`owners`); schema `Tenant.ownerNames`, `MonthlyRoiReport.operationalContact`; `tests/relatorio-mensal-access.test.ts`

**Razão:** o relatório saía endereçado à recepção (Instituto do Sorriso: "Thalita Santos"); ele é de quem decide a mensalidade.

**Impacto:** `db push` + `generate` (web e worker); `MonthlyCloseWizard` exige a prop `owners`; rascunho com decisor fora de `Tenant.ownerNames` não fecha nem registra envio; PDF inalterado.

### [2026-10-01] — Âncora na agenda e bloco financeiro opcional

**Arquivos:** `monthly-executive.ts` (novo); `monthly-config.ts` (`financialEnabled`); `monthly-pendencies.ts` (tópicos financeiros condicionais, `optional`); `monthly-overrides.ts`, `monthly-quality.ts`, `monthly-limitations.ts`, `monthly.ts` (mediana), `monthly-pdf.ts`, `monthly-analysis.ts`; `MonthlyView.tsx`, `MonthlyRoiEditor.tsx`, `MonthlyPendencyCenter.tsx`, `FinancialView.tsx`

**Razão:** página 1 abria com "ROI: Pendente"; o relatório passa a medir o que o Fechai controla.

**Impacto:** sem schema novo; relatório sem premissas financeiras fecha sem pendência; `MonthlyRoiSummary` perdeu `showMissing`.

### [2026-09-30] — PDF e painel: resumo executivo + análise detalhada

**Arquivos:** `monthly-pdf.ts` (reescrito: página 1 fixa, detalhe que flui); `monthly-next-actions.ts` (novo); `monthly.ts`, `monthly-ai.ts`, `monthly-analysis.ts` (`nextActions`); `MonthlyView.tsx` (`MonthlyRoiSummary` executivo); `MonthlyRoiEditor.tsx`, `actions.ts`; schema `MonthlyRoiReport.nextActions`

**Razão:** o decisor vê primeiro o valor entregue; o técnico fica para consulta.

**Impacto:** PDF deixa de ter uma página; `db push` + `generate`; `highlights` = "Resumo do período" (600).

### [2026-09-30] — Assistente de IA com ferramentas de leitura

**Arquivos:** `monthly-ai-tools.ts` (novo); `monthly-ai-service.ts` (laço de ferramentas, `MonthlyAiAnswer`); `monthly-ai.ts` (`proposal`); `monthly-ai-chat.ts` (`consulted`, `review`); `monthly-evidence.ts` (`kind` do agendamento); `ai-actions.ts`; `MonthlyRoiAiAssistant.tsx`; `tests/relatorio-mensal-ai-tools.test.ts`

**Razão:** a IA explicava números só pelo resumo; agora consulta os registros e mostra as evidências.

**Impacto:** sem schema novo; `answerMonthlyAi(messages, draft, toolbox?)` devolve `consulted` sempre.

### [2026-09-30] — Assistente de fechamento em 5 etapas + fechar com cobertura parcial

**Arquivos:**
- `monthly-limitations.ts`, `monthly-analysis.ts` (novos); `monthly.ts` (`limitations`, `highlights`, `limitationsNote`); `monthly-quality.ts` ("Não verificado", `QUALITY_KEY_LABEL`); `monthly-pdf.ts`; `monthly-ai(-service).ts`; `monthly-time.ts` (`reviewTextProblem`)
- `admin/relatorios/[tenantId]/MonthlyRoiEditor.tsx` (`MonthlyCloseWizard`), `actions.ts`, `ai-actions.ts`, `page.tsx`, `pdf/route.ts`; `relatorios/MonthlyView.tsx`
- Schema: `MonthlyRoiReport.highlights`, `limitationsNote`; testes `relatorio-mensal-fechamento.test.ts`

**Razão:** fluxo guiado em vez de todos os campos de uma vez; fechar sem todos os dados, com limitações explícitas.

**Impacto:** `finalizeMonthlyRoi` recebe `string[]`; `db push` + `generate`; snapshots antigos sem `limitations` caem no `missing`.

### [2026-09-30] — Documentação inicial + origem e selo de qualidade de cada número

**Arquivos:**
- `monthly-evidence.ts`, `monthly-quality.ts` (novos); `monthly.ts` (`evaluateMonthlyMetrics`, `evidence`/`quality` no relatório); `monthly-time.ts` (sink de mensagens); `monthly-pdf.ts` (coluna Qualidade, legenda no rodapé)
- `relatorios/MonthlyEvidence.tsx`, `EvidenceDialog.tsx`, `MonthlyView.tsx`; `ui/modal.tsx` (`size="full"`), `ui/stat.tsx` (`footer`)
- `lead-insights/queries.ts` (`loadLeadQualityDetail`); `tests/relatorio-mensal-registros.test.ts`

**Razão:** "10 agendamentos" com 1 sem horário e 8 sem tipo, sem evidência da composição.

**Impacto:** sem schema novo; snapshots antigos sem `evidence`/`quality` escondem selo e registros.
