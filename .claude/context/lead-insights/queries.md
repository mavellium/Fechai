# lead-insights — Queries (leitura)

## loadLeadQuality(tenantId, { from, to }, { agentIds?, now? }) → LeadQuality
- **Coorte:** leads reais (`isTest: false`) com `createdAt` em `[from, to)`; `from: null` = desde o início.
- **Select:** só metadados (status, agendamentos, `needsHuman`, `lastInboundAt`, `followUpReason`, evento handoff, insight). **Nunca** nome, telefone ou texto de conversa.
- **Teto:** 20.000 leads. **Escopo:** `agentIds` filtra por `conversation.agentId`.
- **Uso:** `/relatorios?visao=leads` e `computeMonthlyReport` (só o mês, no escopo de agentes).

## getServiceArea(tenantId) → ServiceArea | null
- Nunca lança; `null` = não configurada (ou ilegível).

## Puros (`summary.ts`, `service-area.ts`, `city.ts`)
- `summarizeLeadQuality(rows, area, now)` → agregado; `leadOutcome(row, now)` → `{ outcome, lossKey }`.
- `classifyCity(area, cityKey)` → `in | out | unknown` (sem área = `unknown`).
- `trafficSuggestions(q)` → `string[]` (regra, sem IA); `leadQualityHeadline(q)` → frase-resumo; `SUGGESTION_DISCLAIMER`.
- `displayCity(label)`, `describeServiceArea(area)`, `splitCityList(text)`.

## Relatório mensal
- `MonthlyReport.leadQuality?` (opcional; ausente em fechados antigos = "sem registro"). `generateMonthlyPdf` cria a 2ª página só se `leadQuality.leads > 0`.
