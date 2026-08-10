<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Working in /relatorios (relatórios + visão Financeira)

Before touching the reports area, read `src/app/(dashboard)/relatorios/README.md` — it documents the file map, exact calculation rules (window resolution, IA×humano bucketing, financial ROI with `TenantLeadValue`), the Prisma `db push` + `generate` workflow (Windows file-lock gotcha), and how to extend charts/metrics. Money is always stored in cents and formatted with `formatBRL()` from `src/lib/format.ts`.

## Working in billing / uso (planos, limites, enforcement)

Before touching plan/usage logic, read `src/modules/billing/README.md` and `src/modules/billing/usage.ts` — that's the single source for the conversation quota: `getUsageSummary(tenantId)` computes `used` (conversas reais com atividade no mês, sandbox não conta) vs the effective limit (override do admin `Tenant.conversationLimitOverride` or the plan's `conversationsPerMonth`). Enforcement lives in `runAgentTurn` (`src/modules/agent-engine/orchestrator.ts`, `TurnStatus = "limit_reached"`): além da cota da conta, cada conversa tem um teto de respostas da IA por mês (`perConversationCap`, default = limite efetivo × 3, com override próprio `Tenant.perConversationCapOverride`), com uso real em `perConversationUsed` (conversa mais ativa); o sandbox pula tudo via `skipUsageCheck`. The navigation indicator (`src/components/shell/UsageNav.tsx`) and the "Uso atual" card in `src/app/(dashboard)/configuracoes/page.tsx` show both quotas with their own usage. Admin limit override: `src/app/(admin)/admin/contas/TenantRow.tsx` + `adminSetUsageLimit` — o admin edita as duas cotas independentes (conversas e respostas por conversa).
