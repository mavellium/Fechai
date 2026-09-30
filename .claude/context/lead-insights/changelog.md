# lead-insights — Histórico

**Instrução:** Atualize aqui cada vez que mexer neste módulo.

### [2026-09-30] — Leads um a um no relatório mensal

**Arquivos:**
- `queries.ts`: `loadLeadQualityDetail` (`loadLeadQuality` passa a delegar a ele); select ganha `id` do lead e da conversa

**Razão:** abrir "273 leads" nos registros que compõem o número.

**Impacto:** sem schema novo; continua sem nome, telefone ou texto de conversa.

### [2026-09-29] — MVP da inteligência de conversas

**Arquivos:**
- `lead-insights/*`, `prisma/schema.prisma` (`ConversationInsight`, `TenantServiceArea`)
- `agent-engine/tools.ts`, `orchestrator.ts`: tool `record_lead_insight` + regra no prompt
- `relatorios/LeadQualityView.tsx`, `MonthlyView.tsx`, `monthly.ts`, `monthly-pdf.ts` (2ª página)
- `configuracoes/ServiceAreaForm.tsx`: card "Área de atendimento"

**Razão:** medir lead de tráfego fora do raio (Instituto do Sorriso, Garça × Marília).

**Impacto:** `db push` + `generate` em web e worker; fase 2 (categorias sugeridas, exportação para a agência) fica para depois de ~1 mês de dados.
