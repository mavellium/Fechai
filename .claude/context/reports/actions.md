# reports — Server Actions

Admin (`src/app/(admin)/admin/relatorios/[tenantId]/actions.ts`), todas `requireSuperadmin()`, retornam `Result { ok, info?, error? }`:

## previewMonthlyRoiImport(tenantId, month, form)
- Prévia de leitura com agentes selecionados; valida agentes do tenant; não grava.

## saveMonthlyRoi(tenantId, month, prev, form)
- Premissas + `metricOverrides` + textos (inclui `highlights`, `limitationsNote`); `updatedAt` protege concorrência; recusa relatório fechado; auditoria.
- Caso do mês (`featuredCaseProblem`), resumo do período, limitações e próximas ações (`reviewTextProblem`: só e-mail e nome de contato) recusam dado de paciente.
- `nextActions` (JSON no form, `nextActionsSchema`); ausente no form = mantém as salvas.

## finalizeMonthlyRoi(tenantId, month, acknowledged: string[])
- Fluxo: `computeMonthlyReport(..., false)` → recusa mês em andamento, limitações sem confirmação, lista ≠ `acknowledged` (`sameLimitations`), textos vazios → grava `snapshot` (`evidence` + `quality` + `limitations`).
- Pendência **não** bloqueia; nem selo "inconsistente". Auditoria: chaves das limitações + `unverified`.

## reopenMonthlyRoi(tenantId, month)
- Só antes do envio; valores do snapshot viram `metricOverrides.current` (dado que mudou depois aparece como inconsistente).

## recordMonthlyDelivery(tenantId, month, "sent" | "meeting")
- Registra envio/reunião feitos pela equipe; não envia nada.

## IA (`ai-actions.ts`): assistMonthlyRoi / loadMonthlyRoiAiChat / clearMonthlyRoiAiChat
- Agregados no contexto + ferramentas só de leitura (`createMonthlyAiToolbox`) sobre `evidence`, conversa do mês, config e integrações; nunca texto/paciente. Resposta: `consulted` (servidor) e `review` (lista proposta, só ids consultados). Sugestões aplicadas por botão.

## generateMonthlyRoiAnalysis(tenantId, month, form{ draft, context })
- Etapa 4: agregados + selo + limitações + `AuditLog` `agent.*`/`knowledge.*` do mês agrupado (fora do escopo de agentes sai; `knowledge.gap_*` sem alvo). Mesmo rate limit `monthly-roi-ai`; recusa relatório fechado; não grava.

## Tenant (`src/app/(dashboard)/relatorios/actions.ts`)
- `saveLeadValue`, `saveAttendanceCost`: réguas com vigência da visão Financeira.

## events.ts
- `recordReportEvent({ tenantId, conversationId, kind, procedure? })`: qualified/handoff/unanswered, idempotente, best-effort.
