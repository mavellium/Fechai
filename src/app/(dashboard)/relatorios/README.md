# Seção: /relatorios (painel de relatórios + visão Financeira)

Guia para qualquer agente/pessoa dar prosseguimento nesta seção. Cobre **o que existe, as regras de cálculo, os arquivos, as armadilhas** e **como estender** — leia inteiro antes de mexer.

## Visão geral

`/relatorios` tem **duas visões**, trocadas por um toggle no topo (querystring `?visao=`):

- **Operacional** (padrão): KPIs com delta vs. período anterior, gráficos (fluxo, resultados, atendimento IA×humano, leads fechados IA×humano, donut por agente, leads por status, funil de conversão, resolução autônoma, recuperação por follow-up, horários de pico, tempo até a primeira resposta, comparecimento/no-show) e exportação CSV.
- **Financeiro**: retorno financeiro **estimado** do investimento no projeto — KPIs (Retorno, Investido, ROI, Ponto de equilíbrio), gráfico de retorno acumulado × investido, retorno por agente, retorno mês a mês e custo por lead fechado. O valor por lead é definido manualmente pelo dono da conta; sem ele, os gráficos que dependem desse valor mostram um estado vazio com a chamada para definir, nunca uma série de zeros.

Tudo começa na `page.tsx`, que resolve a janela (`?periodo=`/`?de=&ate=`), computa os dados no servidor e entrega a props serializáveis aos componentes client.

## Regras de ouro (não quebrar)

1. **Multi-tenant**: toda query filtra por `tenantId` (regra global do projeto).
2. **Sandbox não conta**: toda métrica usa `isTest: false` (o chat de teste inflaria os números).
3. **Dinheiro é sempre em centavos** (`Int`): `valueCents`, `priceCents`. Exibir com `formatBRL()` de `src/lib/format.ts`.
4. **A visão Financeira é estimativa**: valor por lead é subjetivo e o investido presume o **plano atual** por todo o período. A UI usa as palavras "estimado"/"aproximado" — nunca prometer exatidão.
5. **Cor nunca é o único indicador** (design-ui skill §4): selo de ROI carrega texto (`ROI +128%`), não só verde/vermelho; o meter de resolução autônoma sempre mostra o `%` em texto.
6. **Todo bucketing usa o fuso do painel** (`America/Sao_Paulo`, constante `PANEL_TIME_ZONE` em `service.ts`). Nunca `new Date(y, m, d)`/`getFullYear()`/`Intl.DateTimeFormat` sem `timeZone` — isso é hora do SERVIDOR, que em produção é UTC. Use `partsInZone`/`zonedTimeToUtc` de `src/modules/scheduling/time.ts`.
7. **Paleta categórica só de `src/components/charts/palette.ts`** (`chartColor(index)`, variáveis CSS `--chart-1..5`). Nunca um hex novo solto num gráfico — a ordem atual foi validada com o script do skill dataviz; um hex fora dela pode reprovar CVD sem ninguém notar.

## Arquivos (mapa)

### Servidor (dados)

| Arquivo | Papel |
| --- | --- |
| `src/modules/reports/service.ts` | `resolveRange`, `computePeriodReport`, `computeFinancialSummary` + todos os tipos (`PeriodKey`, `ReportRange`, `FlowPoint`, `ResultPoint`, `AiHumanPoint`, `FunnelStep`, `HeatmapCell`, `ResponseTimeBucket`, `AttendanceOutcomePoint`, `PeriodReport`, `CumulativeReturnPoint`, `AgentReturnPoint`, `MonthlyReturnPoint`, `FinancialSummary`). |
| `src/modules/scheduling/time.ts` | `partsInZone`, `zonedTimeToUtc` — base de todo o bucketing com fuso correto (ver regra 6). |
| `src/modules/billing/plans.ts` | `PLANS` e `planOf(planKey)` — fonte do "investido" (preço do plano). |
| `src/lib/format.ts` | `formatBRL(cents)` (e `dateLabel`, `relativeTime`, etc.). |
| `prisma/schema.prisma` | Modelo `TenantLeadValue` (valor por lead com vigência). |
| `src/app/(dashboard)/relatorios/actions.ts` | Server action `saveLeadValue` (salva/altera valor por lead). |

### Página e componentes (UI)

| Arquivo | Papel |
| --- | --- |
| `page.tsx` | Server Component: lê `?periodo/de/ate/visao`, `resolveRange`, computa sob demanda, toggle `FilterTabs`, estado vazio, renderiza Operacional **ou** Financeiro. |
| `RangePicker.tsx` | `<details>` com presets de período + intervalo custom; **preserva `?visao=`** nos links e no form (hidden input). |
| `FinancialView.tsx` | "use client": linha de KPIs, card "Retorno estimado" + "Valor do lead" com `<dialog>` (campo com máscara `CurrencyInput`), delega os gráficos a `FinancialCharts.tsx`. |
| `FinancialCharts.tsx` | "use client": retorno acumulado × investido, retorno por agente, retorno mês a mês, custo por lead. Só renderizado com valor por lead definido. |
| `ChartPanel.tsx` | "use client": moldura de card para os gráficos Operacionais, com `ChartActions` (Ampliar / Como é calculado) e tabela de dados. |
| `BarsChart.tsx` / `DonutChart.tsx` / `FlowChart.tsx` / `SeriesChart.tsx` | Gráficos em SVG/divs (sem lib). `SeriesChart` é o genérico de 2 séries (agora com eixo Y, crosshair/tooltip e rótulo de pico); `FlowChart` é um wrapper dele. |
| `StatusBreakdown.tsx` | "use client": lista de leads por status. |
| `export/route.ts` | Exporta o relatório **Operacional** em CSV (`;` + BOM, abre no Excel BR). |

### Compartilhados (`src/components/charts/`)

| Arquivo | Papel |
| --- | --- |
| `palette.ts` | Paleta categórica validada (skill dataviz) + `chartColor(index)`. **Fonte única de cor categórica** — ver regra 7. |
| `ChartActions.tsx` | Botões "Ampliar" e "Como é calculado" + dialogs. |
| `ChartTable.tsx` | Tabela de dados do gráfico (tela cheia). |
| `ChartTooltip.tsx` | `ChartTooltip`, `ChartCrosshair`, `ChartHoverLayer` — hover/foco de teclado compartilhado entre os gráficos de série e barra. |
| `ChartAxisY.tsx` | `ChartAxisY` (3 gridlines + rótulos) e `niceAxisMax` (arredonda o pico bruto para um valor de eixo limpo). |
| `HeatmapChart.tsx` | Grade 7×24 (dia da semana × hora) — horários de pico. |
| `FunnelChart.tsx` | Barras horizontais em ordem — funil de conversão. |
| `MeterChart.tsx` | Medidor de razão 0–100% — resolução autônoma. |
| `DivergingBars.tsx` | Barras acima/abaixo do zero — retorno mês a mês. |
| `HorizontalBars.tsx` | Lista rankeada de barras horizontais — tempo até resposta, retorno por agente. |
| `src/components/ui/currency-input.tsx` | Campo de preço com máscara pt-BR (client). |
| `src/components/ui/filter-tabs.tsx` | Toggle por links (`aria-current="page"`). |

## Regras de cálculo (definições exatas)

### Janela (`resolveRange`)

- `?periodo=` (`hoje | 7 | 30 | mes | ano | tudo`) ou `?de=&ate=` (custom tem prioridade).
- Devolve `from/to` (também `prevFrom/prevTo` para os deltas) e a granularidade do gráfico: `hora` (janela ≤ 1 dia), `dia` (≤ 62 dias), `mes` (mais longo). `"tudo"` → `from: null` (desde o início da conta).
- A série começa na **primeira mensagem da conta** quando `from` é null (evita gráfico vazio).
- Todos os limites de dia/mês/hora são calculados no fuso do painel (regra de ouro 6) — "hoje" começa à meia-noite de Brasília, não do servidor.

### `computePeriodReport`

- **KPIs**: conversas ativas (por `updatedAt`), leads novos, agendamentos (`Appointment` com `startsAt` no período e `status in ["scheduled","done"]`), mensagens recebidas/enviadas (`role user/assistant`), taxa de resposta (conversas com 2+ mensagens do lead), leads quentes e "precisam de você" (**estado atual**, não do período).
- **`flow`**: recebidas × enviadas por bucket.
- **`results`**: leads novos × agendamentos por bucket.
- **`attendance`** (atendimento IA×humano): contatos **exclusivos por bucket**. Um contato que recebeu resposta da IA E do humano no mesmo bucket entra só em "humano" (`ai = aiSet.size − humanSet.size`). Base: `Message.sentBy` em `["agent","human"]`.
- **`closed`** (leads fechados IA×humano): agendamentos **efetivados** (`status in ["scheduled","done"]`) criados no período, por `Appointment.source` — `"agent"` → IA, senão humano. Alinhado ao KPI "Agendamentos" desde 2026-08-11 — antes contava cancelado como fechado (ver CHANGELOG).
- **`funnel`**: Conversas (do período) → Leads engajados (leads criados no período com 2+ mensagens, capado no total de leads criados) → Leads quentes (status `hot`, dos criados no período) → Agendados (soma de `results.appts`). **Estado atual** dos leads que chegaram na janela — não há histórico de transição de status, então não é velocidade de funil.
- **`peakHours`**: mensagens `role: "user"` do período, uma célula por (dia da semana 0-6, hora 0-23), no fuso do painel.
- **`firstResponseTime`**: por conversa, a primeira mensagem `user` pendente vs. a primeira `assistant` seguinte, bucketado em faixas (`<1min, 1-5min, 5-30min, 30min-2h, +2h`), separado por `sentBy` (IA/humano). Um par por conversa — a segunda pergunta de uma conversa já respondida não conta de novo.
- **`autonomyRate`**: `{ current, previous }` — fração `ai/(ai+human)` da mesma base de `attendance`, resumida num número por período (atual e anterior).
- **`followUpRecovery`**: `{ sent, recovered }` — conversas com `followUpSentAt` no período (`sent`) e, destas, quantas tiveram uma mensagem `user` com `createdAt` depois do envio, **dentro do mesmo período** (`recovered`). Não olha além da janela selecionada — consistente com o resto do relatório.
- **`attendanceOutcome`**: agendamentos concluídos × cancelados, por bucket, base `createdAt`.
- **Deltas**: comparação contra a janela anterior do mesmo tamanho (`prevFrom/prevTo`).

### `computeFinancialSummary` (visão Financeira)

- **`closedLeads`**: agendamentos **efetivados** (`status in ["scheduled","done"]`) criados no período — mesma base do gráfico `closed` do Operacional.
- **`months`**: meses de calendário (fuso do painel) tocados pela janela, mínimo 1. "Hoje"/"7"/"30" dentro do mesmo mês → 1. Para `"tudo"`, ancora na **criação da conta** (`Tenant.createdAt`).
- **`investedCents`**: `planOf(tenant.planKey).priceCents × months`.
- **Valor por lead** (`TenantLeadValue`): entradas com vigência (`startsAt`). O valor usado é o **em vigor no início da janela** (`maior startsAt ≤ from`); sem nenhum até lá, usa o mais antigo (valor definido no meio de uma janela curta). `"tudo"` usa o valor **atual** (mais recente). **Mudar o valor não recalcula períodos que já começaram** — é o contrato do "histórico por período".
- **`returnCents`**: `closedLeads × valuePerLeadCents` (null enquanto não há valor definido).
- **`roiPercent`**: `(retorno − investido) / investido × 100`, arredondado. `null` se `investedCents = 0` (Plano Grátis) ou sem valor definido.
- **`cumulative`** (`null` sem valor por lead): retorno acumulado × investido acumulado, por bucket. Investido é o total dividido em partes iguais pelos buckets — aproximação estimada (o plano é mensal, não por bucket).
- **`byAgent`** (`null` sem valor por lead): `closedLeads` agrupado por `Appointment.agentId` × valor por lead, maiores primeiro.
- **`breakEvenLeads`** (`null` sem valor por lead): `ceil(investedCents / valuePerLeadCents)`.
- **`monthly`** (`null` sem valor por lead): um ponto por mês de calendário tocado pela janela, `retorno do mês − investido do mês` (investido também dividido em partes iguais pelos meses).
- **`costPerLeadCents`**: `investedCents / closedLeads`, `null` sem fechamento no período.

### Selo de ROI (FinancialView)

- `roi > 0` → badge `success` ("ROI +128%"); `roi < 0` → `danger`; `roi = 0` ou `null` → `neutral` ("ROI —").

## Armadilhas (já mordemos; leia antes de depurar)

1. **`prisma generate` falha no Windows se o dev server estiver rodando** — `EPERM` ao renomear `query_engine-windows.dll.node` (arquivo está com lock). Sintoma: a página que usa o modelo novo estoura `Cannot read properties of undefined (reading 'findMany')`, porque o client em memória é antigo. Solução: parar o dev server, rodar `npx prisma generate`, reiniciar o dev. (O `tsc` passa mesmo com o client desatualizado — os `.d.ts` regeneram, o `.js` não.)
2. **Modais**: o reset do Tailwind zera o `margin: auto` da UA que centralizaria o `<dialog>` nativo — todo **modal** precisa da classe `m-auto`. Drawers laterais (`MobileNav`, `Navbar` da landing) são ancorados **de propósito** (`mr-auto ml-0` / `m-0 ml-auto`), não "corrigir".
3. **Smoke test sem login**: `/relatorios*` responde **307 → /login** para requisição não autenticada — é o sinal de sucesso esperado (a página compila e o guarda roda). 200 só com cookie de sessão.
4. **CSV**: apenas na visão Operacional (o botão some em `?visao=financeiro`). Sem `?visao=` na URL da exportação — ela usa só `periodo/de/ate`.
5. **Mudança de schema**: o projeto usa `prisma db push` (sem migrations). Tabela nova = adicionar ao schema + push. Para mudanças destrutivas que precisam preservar dados, há precedente em `prisma/manual/001-multi-agente.sql`.
6. **Gráficos**: SVG puro/divs, sem biblioteca. `SeriesChart` usa `preserveAspectRatio="none"` + `non-scaling-stroke`; hover/foco vêm de `ChartTooltip`/`ChartHoverLayer` (o `<title>` nativo continua como reforço, não como única via).
7. **Fuso**: se um número de bucket parecer deslocado (ex.: "hoje" começando ontem à noite), é quase sempre um `new Date(y, m, d)`/`getFullYear()`/`Intl.DateTimeFormat` sem `timeZone` que voltou a usar hora do servidor — ver regra de ouro 6. Isso já aconteceu uma vez nesta seção; o server local é America/Sao_Paulo, então o bug só aparece em produção (UTC).
8. **Paleta**: nunca reordenar `CHART_LIGHT`/`CHART_DARK`/as variáveis `--chart-N` sem rodar `node scripts/validate_palette.js "<hex,...>" --mode light/dark` do skill dataviz de novo — a ordem atual (iris, warn, success, signal, violeta) foi escolhida especificamente para separar dois tons que ficavam indistinguíveis (ΔE abaixo do piso) na ordem antiga.

## Como estender

### Novo gráfico Operacional

1. Tipo + série nova em `computePeriodReport` (`service.ts`) — reuse o padrão de buscar timestamps com `select` estreito e bucketar em memória (não há `_lib`/SQL cru nesta seção).
2. Variante em `ChartPanel.tsx`: incluir em `Variant`, `DESCRIPTIONS`, `chart()`, `table()` e `sources()`.
3. (Opcional) seção nova no CSV em `export/route.ts`.
4. Posicionar o `ChartPanel` na `page.tsx`.
5. Se o gráfico usa cor categórica (mais de 2 séries por identidade, não por polaridade), usar `chartColor(index)` de `palette.ts` — nunca um hex novo.

### Nova métrica Financeira

1. Campo em `FinancialSummary` + cálculo em `computeFinancialSummary`. Se depender do valor por lead, retornar `null` quando `effective` for `null` (nunca uma série de zeros — ver `FinancialView.tsx`, que já decide o estado vazio).
2. Render em `FinancialCharts.tsx` (lembrar: dinheiro → `formatBRL`, sempre "estimado").

### Toggle de visão

O toggle é `FilterTabs` (links, querystring) — preserva `periodo/de/ate` e seta `visao`. Qualquer novo valor de `visao` precisa entrar em `VIEWS` no `page.tsx`.

## Próximos passos sugeridos (não feitos)

- Investido por período real: hoje presume o plano **atual** para todo o período (não há histórico de assinatura no modelo). Se um dia existir `SubscriptionHistory`, trocar a base do `investedCents` (e de `cumulative`/`monthly`, que hoje distribuem o total em partes iguais).
- CSAT via `Feedback.rating` — computável hoje, ainda não está em nenhum relatório (é feedback do produto, não da operação do cliente — provavelmente um relatório à parte).
- Canal de origem do lead (WhatsApp × widget × manual): não existe campo hoje. Provavelmente o campo isolado de maior valor a acrescentar — habilitaria atribuição de canal em quase todo gráfico de leads/conversas.
- Histórico de status de lead (`Lead` não tem `updatedAt` nem log de transição): bloqueia velocidade de funil e "quantos viraram quentes esta semana". O funil atual é estado-no-momento por isso.

## Como rodar/verificar

- Dev server: `npm run dev` (porta 3001).
- Typecheck: `npx tsc --noEmit`.
- Lint da seção: `npx eslint "src/app/(dashboard)/relatorios" "src/modules/reports" "src/components/charts"`.
- Paleta: `node scripts/validate_palette.js "<hex,hex,...>" --mode light` e `--mode dark` (script do skill dataviz) → espera **ALL CHECKS PASS** nos dois modos antes de mudar qualquer cor categórica.
- Smoke: `Invoke-WebRequest http://localhost:3001/relatorios -MaximumRedirection 0` → espera **307**.
