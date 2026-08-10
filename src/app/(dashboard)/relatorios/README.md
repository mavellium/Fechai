# Seção: /relatorios (painel de relatórios + visão Financeira)

Guia para qualquer agente/pessoa dar prosseguimento nesta seção. Cobre **o que existe, as regras de cálculo, os arquivos, as armadilhas** e **como estender** — leia inteiro antes de mexer.

## Visão geral

`/relatorios` tem **duas visões**, trocadas por um toggle no topo (querystring `?visao=`):

- **Operacional** (padrão): KPIs com delta vs. período anterior, gráficos (fluxo, resultados, atendimento IA×humano, leads fechados IA×humano, donut por agente), status dos leads e exportação CSV.
- **Financeiro**: retorno financeiro **estimado** do investimento no projeto — KPI "Retorno estimado" (leads fechados × valor por lead) + selo de ROI%, com o valor por lead definido manualmente pelo dono da conta.

Tudo começa na `page.tsx`, que resolve a janela (`?periodo=`/`?de=&ate=`), computa os dados no servidor e entrega a props serializáveis aos componentes client.

## Regras de ouro (não quebrar)

1. **Multi-tenant**: toda query filtra por `tenantId` (regra global do projeto).
2. **Sandbox não conta**: toda métrica usa `isTest: false` (o chat de teste inflaria os números).
3. **Dinheiro é sempre em centavos** (`Int`): `valueCents`, `priceCents`. Exibir com `formatBRL()` de `src/lib/format.ts`.
4. **A visão Financeira é estimativa**: valor por lead é subjetivo e o investido presume o **plano atual** por todo o período. A UI usa as palavras "estimado"/"aproximado" — nunca prometer exatidão.
5. **Cor nunca é o único indicador** (design-ui skill §4): selo de ROI carrega texto (`ROI +128%`), não só verde/vermelho.

## Arquivos (mapa)

### Servidor (dados)

| Arquivo | Papel |
| --- | --- |
| `src/modules/reports/service.ts` | `resolveRange`, `computePeriodReport`, `computeFinancialSummary` + tipos (`PeriodKey`, `ReportRange`, `FlowPoint`, `ResultPoint`, `AiHumanPoint`, `PeriodReport`, `FinancialSummary`). |
| `src/modules/billing/plans.ts` | `PLANS` e `planOf(planKey)` — fonte do "investido" (preço do plano). |
| `src/lib/format.ts` | `formatBRL(cents)` (e `dateLabel`, `relativeTime`, etc.). |
| `prisma/schema.prisma` | Modelo `TenantLeadValue` (valor por lead com vigência). |
| `src/app/(dashboard)/relatorios/actions.ts` | Server action `saveLeadValue` (salva/alterta valor por lead). |

### Página e componentes (UI)

| Arquivo | Papel |
| --- | --- |
| `page.tsx` | Server Component: lê `?periodo/de/ate/visao`, `resolveRange`, computa sob demanda, toggle `FilterTabs`, estado vazio, renderiza Operacional **ou** Financeiro. |
| `RangePicker.tsx` | `<details>` com presets de período + intervalo custom; **preserva `?visao=`** nos links e no form (hidden input). |
| `FinancialView.tsx` | "use client": KPI "Retorno estimado" + selo ROI + card "Valor do lead" com `<dialog>` (campo com máscara `CurrencyInput`). |
| `ChartPanel.tsx` | "use client": moldura de card para gráficos com `ChartActions` (Ampliar / Como é calculado) e tabela de dados. |
| `BarsChart.tsx` / `DonutChart.tsx` / `FlowChart.tsx` / `SeriesChart.tsx` | Gráficos em SVG/divs (sem lib). `SeriesChart` é o genérico de 2 séries; `FlowChart` é um wrapper dele. |
| `StatusBreakdown.tsx` | "use client": lista de leads por status. |
| `export/route.ts` | Exporta o relatório **Operacional** em CSV (`;` + BOM, abre no Excel BR). |

### Compartilhados

| Arquivo | Papel |
| --- | --- |
| `src/components/charts/ChartActions.tsx` | Botões "Ampliar" e "Como é calculado" + dialogs. |
| `src/components/charts/ChartTable.tsx` | Tabela de dados do gráfico (tela cheia). |
| `src/components/ui/currency-input.tsx` | Campo de preço com máscara pt-BR (client). |
| `src/components/ui/filter-tabs.tsx` | Toggle por links (`aria-current="page"`). |

## Regras de cálculo (definições exatas)

### Janela (`resolveRange`)

- `?periodo=` (`hoje | 7 | 30 | mes | ano | tudo`) ou `?de=&ate=` (custom tem prioridade).
- Devolve `from/to` (também `prevFrom/prevTo` para os deltas) e a granularidade do gráfico: `hora` (janela ≤ 1 dia), `dia` (≤ 62 dias), `mes` (mais longo). `"tudo"` → `from: null` (desde o início da conta).
- A série começa na **primeira mensagem da conta** quando `from` é null (evita gráfico vazio).

### `computePeriodReport`

- **KPIs**: conversas ativas (por `updatedAt`), leads novos, agendamentos (`Appointment` com `startsAt` no período e `status in ["scheduled","done"]`), mensagens recebidas/enviadas (`role user/assistant`), taxa de resposta (conversas com 2+ mensagens do lead), leads quentes e "precisam de você" (**estado atual**, não do período).
- **`flow`**: recebidas × enviadas por bucket.
- **`results`**: leads novos × agendamentos por bucket.
- **`attendance`** (atendimento IA×humano): contatos **exclusivos por bucket**. Um contato que recebeu resposta da IA E do humano no mesmo bucket entra só em "humano" (`ai = aiSet.size − humanSet.size`). Base: `Message.sentBy` em `["agent","human"]`.
- **`closed`** (leads fechados IA×humano): agendamentos criados no período por `Appointment.source` — `"agent"` → IA, senão humano.
- **Deltas**: comparação contra a janela anterior do mesmo tamanho (`prevFrom/prevTo`).

### `computeFinancialSummary` (visão Financeira)

- **`closedLeads`**: agendamentos **criados** no período (mesma base do gráfico `closed`).
- **`months`**: meses de calendário tocados pela janela, mínimo 1. "Hoje"/"7"/"30" dentro do mesmo mês → 1. Para `"tudo"`, ancora na **criação da conta** (`Tenant.createdAt`).
- **`investedCents`**: `planOf(tenant.planKey).priceCents × months`.
- **Valor por lead** (`TenantLeadValue`): entradas com vigência (`startsAt`). O valor usado é o **em vigor no início da janela** (`maior startsAt ≤ from`); sem nenhum até lá, usa o mais antigo (valor definido no meio de uma janela curta). `"tudo"` usa o valor **atual** (mais recente). **Mudar o valor não recalcula períodos que já começaram** — é o contrato do "histórico por período".
- **`returnCents`**: `closedLeads × valuePerLeadCents` (null enquanto não há valor definido).
- **`roiPercent`**: `(retorno − investido) / investido × 100`, arredondado. `null` se `investedCents = 0` (Plano Grátis) ou sem valor definido.

### Selo de ROI (FinancialView)

- `roi > 0` → badge `success` ("ROI +128%"); `roi < 0` → `danger`; `roi = 0` ou `null` → `neutral` ("ROI —").

## Armadilhas (já mordemos; leia antes de depurar)

1. **`prisma generate` falha no Windows se o dev server estiver rodando** — `EPERM` ao renomear `query_engine-windows.dll.node` (arquivo está com lock). Sintoma: a página que usa o modelo novo estoura `Cannot read properties of undefined (reading 'findMany')`, porque o client em memória é antigo. Solução: parar o dev server, rodar `npx prisma generate`, reiniciar o dev. (O `tsc` passa mesmo com o client desatualizado — os `.d.ts` regeneram, o `.js` não.)
2. **Modais**: o reset do Tailwind zera o `margin: auto` da UA que centralizaria o `<dialog>` nativo — todo **modal** precisa da classe `m-auto`. Drawers laterais (`MobileNav`, `Navbar` da landing) são ancorados **de propósito** (`mr-auto ml-0` / `m-0 ml-auto`), não "corrigir".
3. **Smoke test sem login**: `/relatorios*` responde **307 → /login** para requisição não autenticada — é o sinal de sucesso esperado (a página compila e o guarda roda). 200 só com cookie de sessão.
4. **CSV**: apenas na visão Operacional (o botão some em `?visao=financeiro`). Sem `?visao=` na URL da exportação — ela usa só `periodo/de/ate`.
5. **Mudança de schema**: o projeto usa `prisma db push` (sem migrations). Tabela nova = adicionar ao schema + push. Para mudanças destrutivas que precisam preservar dados, há precedente em `prisma/manual/001-multi-agente.sql`.
6. **Gráficos**: SVG puro/divs, sem biblioteca. `SeriesChart` usa `preserveAspectRatio="none"` + `non-scaling-stroke` e tooltip via `<title>` nativo.

## Como estender

### Novo gráfico Operacional

1. Tipo + série nova em `computePeriodReport` (`service.ts`).
2. Variante em `ChartPanel.tsx`: incluir em `Variant`, `DESCRIPTIONS`, `chart()`, `table()` e `sources()`.
3. (Opcional) seção nova no CSV em `export/route.ts`.
4. Posicionar o `ChartPanel` na `page.tsx`.

### Nova métrica Financeira

1. Campo em `FinancialSummary` + cálculo em `computeFinancialSummary`.
2. Render em `FinancialView.tsx` (lembrar: dinheiro → `formatBRL`, sempre "estimado").

### Toggle de visão

O toggle é `FilterTabs` (links, querystring) — preserva `periodo/de/ate` e seta `visao`. Qualquer novo valor de `visao` precisa entrar em `VIEWS` no `page.tsx`.

## Próximos passos sugeridos (não feitos)

- Investido por período real: hoje presume o plano **atual** para todo o período (não há histórico de assinatura no modelo). Se um dia existir `SubscriptionHistory`, trocar a base do `investedCents`.
- Melhorar o corte de "lead fechado": hoje é "agendamento criado no período" (inclui cancelados). Decidir se deve filtrar `status in ["scheduled","done"]` para bater com o KPI de agendamentos.
- Gráfico de evolução do retorno acumulado no período (série financeira por bucket).

## Como rodar/verificar

- Dev server: `npm run dev` (porta 3001).
- Typecheck: `npx tsc --noEmit`.
- Lint da seção: `npx eslint "src/app/(dashboard)/relatorios" "src/modules/reports"`.
- Smoke: `Invoke-WebRequest http://localhost:3001/relatorios -MaximumRedirection 0` → espera **307**.
