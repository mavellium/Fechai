# reports — Server Actions

Admin (`src/app/(admin)/admin/relatorios/[tenantId]/actions.ts`), todas `requireSuperadmin()`, retornam `Result { ok, info?, error? }`:

## previewMonthlyRoiImport(tenantId, month, form)
- Prévia de leitura com agentes selecionados; valida agentes do tenant; não grava.

## saveMonthlyRoi(tenantId, month, prev, form)
- Premissas + `metricOverrides` + textos; `updatedAt` protege concorrência; recusa relatório fechado; auditoria.

## finalizeMonthlyRoi(tenantId, month, acknowledgePartial)
- Fluxo: `computeMonthlyReport(..., false)` → recusa mês em andamento, `missing`, cobertura parcial sem ciência, textos vazios → grava `snapshot` (inclui `evidence` + `quality`).
- Não bloqueia selo "inconsistente".

## reopenMonthlyRoi(tenantId, month)
- Só antes do envio; valores do snapshot viram `metricOverrides.current` (dado que mudou depois aparece como inconsistente).

## recordMonthlyDelivery(tenantId, month, "sent" | "meeting")
- Registra envio/reunião feitos pela equipe; não envia nada.

## IA (`ai-actions.ts`): assistMonthlyRoi / loadMonthlyRoiAiChat / clearMonthlyRoiAiChat
- Só agregados (`editableMonthlyMetrics`), nunca `evidence` nem conversas; sugestões aplicadas por botão.

## Tenant (`src/app/(dashboard)/relatorios/actions.ts`)
- `saveLeadValue`, `saveAttendanceCost`: réguas com vigência da visão Financeira.

## events.ts
- `recordReportEvent({ tenantId, conversationId, kind, procedure? })`: qualified/handoff/unanswered, idempotente, best-effort.
