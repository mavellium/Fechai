# reports — Server Actions

Admin (`src/app/(admin)/admin/relatorios/[tenantId]/actions.ts`), todas `requireSuperadmin()`, retornam `Result { ok, info?, error? }`:

## previewMonthlyRoiImport(tenantId, month, form)
- Prévia de leitura com agentes selecionados; valida agentes do tenant; não grava.

## saveMonthlyRoi(tenantId, month, prev, form)
- Premissas + `metricOverrides` + textos (inclui `highlights`, `limitationsNote`); `updatedAt` protege concorrência; recusa relatório fechado; auditoria.
- Caso do mês (`featuredCaseProblem`), resumo do período, limitações e próximas ações (`reviewTextProblem`: só e-mail e nome de contato) recusam dado de paciente.
- `nextActions` (JSON no form, `nextActionsSchema`); ausente no form = mantém as salvas.
- `operationalContact` (≤100) e `accountOwners` (JSON `string[]`; ausente = mantém `Tenant.ownerNames`), gravado na conta na mesma transação, só se a revisão gravou. Decisor preenchido passa por `decisionMakerProblem`; vazio é aceito no rascunho.

- `previousActions` (JSON; só status/resultado valem, a lista vem do snapshot anterior aprovado) e `caseConversationId` + `caseAge` (fatos lidos por `loadMonthlyCaseFacts`; vazio apaga; conversa inválida é recusada). Caso do mês recusa data exata.

## finalizeMonthlyRoi(tenantId, month, acknowledged: string[])
- Recusa também ações do mês anterior sem status/resultado. Não exige mais texto em "O que não saiu como planejado". Grava `approvalVersion + 1` e `snapshot.approval`.
- Fluxo: `computeMonthlyReport(..., false)` → recusa mês em andamento, limitações sem confirmação, lista ≠ `acknowledged` (`sameLimitations`), textos vazios → grava `snapshot` (`evidence` + `quality` + `limitations`).
- Pendência **não** bloqueia; nem selo "inconsistente". Sem retorno estimado, nada financeiro é pedido. Auditoria: chaves das limitações + `unverified`.
- Recusa por `decisionMakerProblem(report, tenant.ownerNames)`: decisor vazio, fora dos donos/sócios ou igual ao contato operacional.

## reopenMonthlyRoi(tenantId, month)
- Só antes do envio; valores do snapshot viram `metricOverrides.current` (dado que mudou depois aparece como inconsistente).

## recordMonthlyDelivery(tenantId, month, "sent" | "meeting")
- Registra envio/reunião feitos pela equipe; não envia nada. É com o decisor do snapshot: nome na mensagem e em `meta.decisionMaker` da auditoria.
- `sent` recusa se esse decisor falha em `decisionMakerProblem` (relatório fechado antes da regra): reabrir e corrigir. `meeting` só exige envio registrado.

## IA (`ai-actions.ts`): assistMonthlyRoi / loadMonthlyRoiAiChat / clearMonthlyRoiAiChat
- Agregados no contexto + ferramentas só de leitura (`createMonthlyAiToolbox`) sobre `evidence`, conversa do mês, config e integrações; nunca texto/paciente. Resposta: `consulted` (servidor) e `review` (lista proposta, só ids consultados). Sugestões aplicadas por botão.

## generateMonthlyRoiAnalysis(tenantId, month, form{ draft, context })
- Etapa 4: agregados + selo + limitações + `AuditLog` `agent.*`/`knowledge.*` do mês agrupado (fora do escopo de agentes sai; `knowledge.gap_*` sem alvo). Mesmo rate limit `monthly-roi-ai`; recusa relatório fechado; não grava.

## Tenant (`src/app/(dashboard)/relatorios/actions.ts`)
- `saveLeadValue`, `saveAttendanceCost`: réguas com vigência da visão Financeira.

## events.ts
- `recordReportEvent({ tenantId, conversationId, kind, procedure? })`: qualified/handoff/unanswered, idempotente, best-effort.
