# Seção: /relatorios (painel de relatórios + visão Financeira)

Guia para qualquer agente/pessoa dar prosseguimento nesta seção. Cobre **o que existe, as regras de cálculo, os arquivos, as armadilhas** e **como estender** — leia inteiro antes de mexer.

## Visão geral

### Qualidade dos leads (`?visao=leads`)

Quinta visão, com o seletor de período das visões Operacional/Financeira:
`LeadQualityView` mostra leads, % que informou a cidade, % fora do raio,
cidades, primeiras dúvidas, motivos de perda e resultado, com as melhorias
sugeridas para o tráfego. Os números vêm de `loadLeadQuality`
(`modules/lead-insights`) — regras, cobertura e limites em
[`lead-insights/README.md`](../../../modules/lead-insights/README.md). O mesmo
resumo entra no relatório mensal (bloco + 2ª página do PDF).

### ROI mensal odontológico (P-79)

A visão `?visao=mensal&mes=YYYY-MM` apresenta relatórios revisados pela Mavellium.
No tenant, a aba só aparece quando há relatório `ready` com snapshot. O seletor
oferece somente competências publicadas e abre a mais recente; um mês ausente
cai na última publicação, e uma conta sem publicações fica na visão Operacional.
O `MonthPicker` compartilhado usa `SelectMenu` e setas, sem input mensal nativo.
No admin, o retorno vem antes da edição recolhível, com `Field`, `CurrencyInput`
e `Switch`. Alterações de formulário são protegidas ao navegar entre meses.
O admin prepara em `/admin/relatorios`, acessível pelo menu **ROI mensal** e
pelo painel de edição da conta. A listagem usa **Por clientes**, sem contador,
com cabeçalhos centralizados: Cliente, Data de entrada do cliente, Revisão e
Ação. A entrada é `Tenant.createdAt`, em data curta de Brasília. O texto sobre
prazo/reunião e as colunas Entrega/Reunião foram retirados da listagem;
seus registros permanecem na revisão individual.
O PDF A4 tem uma página e as cinco partes
solicitadas. Leia [`docs/P-79-relatorio-mensal-roi.md`](../../../../docs/P-79-relatorio-mensal-roi.md)
antes de alterar a nova visão: **não usa a regra do Financeiro legado**.
Receita só vem de avaliações realizadas cuja primeira chegada foi fora do
expediente humano; economia usa o tempo medido (áudio ouvido + mensagens × tempo
por mensagem) e, sem tempo por mensagem, os minutos declarados por conversa.
Premissas mensais, falta de dado explícita, fechamento em snapshot e entrega
manual registrada. A leitura do Clinicorp confirma presença pelo ID do espelho
e pelos status `Type` conferidos pela Mavellium, sem alterar a agenda local.
Conexão cadastrada e consulta com sucesso são estados separados: falha da agenda
preserva a lista válida de status e mostra o endpoint/código HTTP no editor,
sem expor o corpo externo. A importação atualiza o aviso e a lista carregados;
comparecimentos vinculados continuam pendentes quando não há confirmação.
Eventos anteriores à implantação não são inventados. P-86 fica fora.
A fila P-87 (`/perguntas`, [contrato](../../../../docs/P-87-perguntas-sem-resposta.md))
acrescenta a linha **Tempo médio para a equipe responder**: média de
`answeredAt − firstAskedAt` das perguntas aprovadas na competência
(`MonthlyMetrics.gapAnswerSeconds`/`gapsAnswered`, opcionais — snapshot antigo
mostra "Sem registro", mês sem aprovação mostra "Nenhuma aprovada"). Formatação
única em `formatGapTime`/`formatGapTimeShort` (`modules/knowledge-gaps/text.ts`);
no PDF o tempo vai na célula de perguntas sem resposta para não aumentar a página.

#### Tempo que o Fechai devolveu para sua equipe

Bloco do ROI mensal (`src/modules/reports/monthly-time.ts`, puro) que mostra o
trabalho da recepção assumido pelo agente. Regras que não se quebram:

- **Duração do áudio é medida, nunca estimada.** `Message.audioSeconds` vem do
  payload da Evolution (`audioMessage.seconds`) ou, na Meta (que não informa),
  do próprio arquivo OGG (`audioDurationSeconds`, `src/modules/voice/received-audio.ts`).
  `null` = não medido (formato não lido ou áudio anterior à coluna) e aparece
  como "sem duração medida", **nunca como zero**. O histórico desde 23/09/2026
  (quando o áudio recebido passou a ir para a CDN) se mede com
  `scripts/mede-audios-recebidos.ts`.
- **Conta o que o agente respondeu.** Mensagem do contato entra quando a
  primeira resposta depois dela é da IA; se a equipe respondeu primeiro, o
  trabalho foi dela. Áudio sem transcrição (`UNTRANSCRIBED_AUDIO`, `[Áudio]`)
  a IA não ouviu e não conta.
- **Horas devolvidas** = (minutos de áudio × 60 + (mensagens + áudios) ×
  `assumptions.secondsPerMessage`) ÷ 3600. Sem `secondsPerMessage` vale a
  fórmula antiga por conversa; `assumedHours` corrigido manualmente vence as
  duas. `secondsPerMessage` tem `default(null)`: revisões salvas antes dele
  continuam válidas (sem o default, o parse falhava e zerava as premissas).
- **Atendimento** vai da primeira mensagem do contato até a última antes de
  24h de silêncio (a conversa é uma por contato, para sempre, sem "fim"). Só
  entram os iniciados no mês com resposta do agente. Resultado: agendou
  (agendamento do agente, não cancelado, até 24h após a última mensagem) >
  transbordou (`ReportEvent` handoff) > perdido (`Lead.status = lost` hoje, só
  no último atendimento; desqualificado não é perdido) > sem desfecho.
- **Caso do mês** (`MonthlyRoiReport.featuredCase`, até 240 caracteres) é
  escrito pela Mavellium, nunca pela IA. `saveMonthlyRoi` recusa e-mail, 8+
  dígitos seguidos e qualquer palavra do nome de um contato atendido no mês
  (`featuredCaseProblem`). O admin vê sugestões (conversas com áudios longos,
  `loadMonthlyCaseCandidates`) que não vão para o snapshot nem para o PDF.
- `MonthlyMetrics.time` e `MonthlyReport.featuredCase` são **opcionais**:
  snapshots fechados antes deles não os têm, e a tela/PDF escondem o bloco.
- No PDF, o bloco fica logo abaixo do quadro do ROI (explica a "Economia") e
  **substitui a linha "Horas assumidas"** da tabela; a duração por resultado só
  aparece no painel. Com conteúdo máximo sobram ~2pt na página — qualquer linha
  nova no PDF precisa tirar outra (teste em `tests/relatorio-mensal-tempo.test.ts`).

`/relatorios` tem **três visões do produto**, trocadas por um toggle no topo (querystring `?visao=`), além da visão de afiliados para participantes do programa:

- **Operacional** (padrão): KPIs com delta vs. período anterior, gráficos (fluxo, resultados, atendimento IA×humano, leads fechados IA×humano, donut por agente, leads por status, funil de conversão, resolução autônoma, recuperação por follow-up, horários de pico, tempo até a primeira resposta, comparecimento/no-show) e exportação CSV.
- **Financeiro**: retorno financeiro **estimado** do investimento no projeto — KPIs (Retorno, Investido, ROI, Ponto de equilíbrio), gráfico de retorno acumulado × investido, retorno por agente, retorno mês a mês e custo por lead fechado. O valor por lead é definido manualmente pelo dono da conta; sem ele, os gráficos que dependem desse valor mostram um estado vazio com a chamada para definir, nunca uma série de zeros. No fim da visão fica **"O que o agente filtrou"** (triagem): contatos que o agente encerrou por não serem clientes em potencial, e o tempo/dinheiro que isso poupou.
- **ROI mensal** (`mensal`): competência mensal fechada pela Mavellium, com receita somente de avaliações realizadas de contatos que chegaram fora do horário humano, economia estimada, premissas por procedimento e PDF de uma página. Contrato em `docs/P-79-relatorio-mensal-roi.md`.

Tudo começa na `page.tsx`, que resolve a janela (`?periodo=`/`?de=&ate=`), computa os dados no servidor e entrega a props serializáveis aos componentes client.

## Regras de ouro (não quebrar)

1. **Multi-tenant**: toda query filtra por `tenantId` (regra global do projeto).
2. **Sandbox não conta**: toda métrica usa `isTest: false` (o chat de teste inflaria os números).
3. **Dinheiro é sempre em centavos** (`Int`): `valueCents`, `priceCents`. Exibir com `formatBRL()` de `src/lib/format.ts`.
4. **A visão Financeira é estimativa**: valor por lead é subjetivo e o investido presume o **plano atual** por todo o período. A UI usa as palavras "estimado"/"aproximado" — nunca prometer exatidão.
5. **Cor nunca é o único indicador** (design-ui skill §4): selo de ROI carrega texto (`ROI +128%`), não só verde/vermelho; o meter de resolução autônoma sempre mostra o `%` em texto.
6. **Todo bucketing usa o fuso do painel** (`America/Sao_Paulo`, constante `PANEL_TIME_ZONE` em `service.ts`). Nunca `new Date(y, m, d)`/`getFullYear()`/`Intl.DateTimeFormat` sem `timeZone` — isso é hora do SERVIDOR, que em produção é UTC. Use `partsInZone`/`zonedTimeToUtc` de `src/modules/scheduling/time.ts`.
7. **Número que vira dinheiro precisa de régua declarada pelo cliente.** Valor por lead (`TenantLeadValue`) e custo do atendimento (`TenantAttendanceCost`) são definidos pelo dono da conta. Sem a régua, a métrica derivada é `null` e a UI mostra o convite para definir — **nunca** uma média do sistema apresentada como fato. O cliente confere esse número contra a própria folha de pagamento.
8. **Paleta categórica só de `src/components/charts/palette.ts`** (`chartColor(index)`, variáveis CSS `--chart-1..5`). Nunca um hex novo solto num gráfico — a ordem atual foi validada com o script do skill dataviz; um hex fora dela pode reprovar CVD sem ninguém notar.

## Arquivos (mapa)

### Servidor (dados)

| Arquivo | Papel |
| --- | --- |
| `src/modules/reports/service.ts` | `resolveRange`, `computePeriodReport`, `computeFinancialSummary` + todos os tipos (`PeriodKey`, `ReportRange`, `FlowPoint`, `ResultPoint`, `AiHumanPoint`, `FunnelStep`, `HeatmapCell`, `ResponseTimeBucket`, `AttendanceOutcomePoint`, `PeriodReport`, `CumulativeReturnPoint`, `AgentReturnPoint`, `MonthlyReturnPoint`, `FinancialSummary`). |
| `src/modules/scheduling/time.ts` | `partsInZone`, `zonedTimeToUtc` — base de todo o bucketing com fuso correto (ver regra 6). |
| `src/modules/billing/plans.ts` | `PLANS` e `planOf(planKey)` — fonte do "investido" (preço do plano). |
| `src/lib/format.ts` | `formatBRL(cents)` (e `dateLabel`, `relativeTime`, etc.). |
| `prisma/schema.prisma` | Modelos `TenantLeadValue` (valor por lead) e `TenantAttendanceCost` (custo do atendimento manual), ambos com vigência. `Lead.disqualifiedAt`/`disqualifiedReason` (carimbo da triagem). `Tenant.priceCentsOverride` (preço negociado). |
| `src/modules/agent-engine/disqualify.ts` | `DISQUALIFY_REASONS`, `reasonLabel`, `costPerLeadCents` e os tetos de sanidade do custo. Fonte única dos motivos de triagem. |
| `src/app/(dashboard)/relatorios/actions.ts` | Server actions `saveLeadValue` (valor por lead) e `saveAttendanceCost` (minutos + custo/hora do atendimento). |

### Página e componentes (UI)

| Arquivo | Papel |
| --- | --- |
| `page.tsx` | Server Component: lê `?periodo/de/ate/visao/mes`, resolve janela e publicações, computa sob demanda e renderiza Operacional, Financeiro, ROI mensal ou afiliados conforme papel/visão. |
| `MonthlyView.tsx` | Cinco partes do ROI mensal, bloco "Tempo que o Fechai devolveu" (`TimeReturnedCard`), comparação, premissas, fontes e link para exportação do snapshot em PDF. |
| `RangePicker.tsx` | `<details>` com presets de período + intervalo custom; **preserva `?visao=`** nos links e no form (hidden input). |
| `FinancialView.tsx` | "use client": linha de KPIs, card "Retorno estimado" + "Valor do lead" com `<dialog>` (campo com máscara `CurrencyInput`), delega os gráficos a `FinancialCharts.tsx`. |
| `TriagePanel.tsx` | "use client": KPIs da triagem (filtrados / tempo / economia), quebra por motivo e `<dialog>` do custo do atendimento. |
| `FinancialCharts.tsx` | "use client": retorno acumulado × investido, retorno por agente, retorno mês a mês, custo por lead. Só renderizado com valor por lead definido. |
| `ChartPanel.tsx` | "use client": moldura de card para os gráficos Operacionais, com `ChartActions` (Ampliar / Como é calculado) e tabela de dados. |
| `BarsChart.tsx` / `DonutChart.tsx` / `FlowChart.tsx` / `SeriesChart.tsx` | Gráficos em SVG/divs (sem lib). `SeriesChart` é o genérico de 2 séries (agora com eixo Y, crosshair/tooltip e rótulo de pico); `FlowChart` é um wrapper dele. |
| `StatusBreakdown.tsx` | "use client": lista de leads por status. |
| `export/route.ts` | Exporta o relatório **Operacional** em CSV (`;` + BOM, abre no Excel BR). |

### Compartilhados (`src/components/charts/`)

| Arquivo | Papel |
| --- | --- |
| `palette.ts` | Paleta categórica validada (skill dataviz) + `chartColor(index)`. **Fonte única de cor categórica** — ver regra 8. |
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
| `src/components/ui/month-picker.tsx` | Competência via `SelectMenu` e setas; lista restrita de publicações no tenant e proteção de dados não salvos. |
| `src/components/ui/data-table.tsx` | Tabelas do painel; `headerAlign`/`columnAlign` permitem centralizar a listagem administrativa sem alterar as outras tabelas. |

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
- **`investedCents`**: `priceCents × months`, onde `priceCents` é `Tenant.priceCentsOverride ?? planOf(tenant.planKey).priceCents` — o admin pode fixar o preço negociado da conta sem mexer no plano (que mudaria a cota junto).
- **`months` nunca começa antes da conta existir**: o início da janela é clampado em `Tenant.createdAt`. Sem esse corte, "últimos 30 dias" numa conta criada dia 09/09 tocava agosto E setembro e cobrava 2 meses de quem pagou 1 — o "Investido" ficava maior que a fatura e o ROI, menor que a realidade. Mês tocado conta **inteiro**, não proporcional aos dias: é o que a pessoa de fato pagou; ratear daria um ROI mais bonito que o extrato.
- **Valor por lead** (`TenantLeadValue`): entradas com vigência (`startsAt`). O valor usado é o **em vigor no início da janela** (`maior startsAt ≤ from`); sem nenhum até lá, usa o mais antigo (valor definido no meio de uma janela curta). `"tudo"` usa o valor **atual** (mais recente). **Mudar o valor não recalcula períodos que já começaram** — é o contrato do "histórico por período".
- **`returnCents`**: `closedLeads × valuePerLeadCents` (null enquanto não há valor definido).
- **`roiPercent`**: `(retorno − investido) / investido × 100`, arredondado. `null` se `investedCents = 0` (Plano Grátis) ou sem valor definido.
- **`cumulative`** (`null` sem valor por lead): retorno acumulado × investido acumulado, por bucket. Investido é o total dividido em partes iguais pelos buckets — aproximação estimada (o plano é mensal, não por bucket).
- **`byAgent`** (`null` sem valor por lead): `closedLeads` agrupado por `Appointment.agentId` × valor por lead, maiores primeiro.
- **`breakEvenLeads`** (`null` sem valor por lead): `ceil(investedCents / valuePerLeadCents)`.
- **`monthly`** (`null` sem valor por lead): um ponto por mês de calendário tocado pela janela, `retorno do mês − investido do mês` (investido também dividido em partes iguais pelos meses).
- **`costPerLeadCents`**: `investedCents / closedLeads`, `null` sem fechamento no período.
- **`triage`** (bloco "O que o agente filtrou"): `screened` = leads com `disqualifiedAt` no período (`isTest: false`), carimbados pela tool `disqualify_lead`. `previousScreened` é a mesma contagem na janela anterior (delta). `byReason` agrupa por `disqualifiedReason`, maiores primeiro. `minutesSaved`/`savedCents` derivam de `TenantAttendanceCost` (vigência igual à do valor por lead: o custo em vigor no início da janela) e são `null` enquanto a clínica não declarar o custo — ver regra de ouro 7.

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
8. **Desqualificado ≠ perdido**: `Lead.disqualifiedAt` é "nunca foi cliente" (vendedor, trote, fora da área); `Lead.status: "lost"` é "era cliente e não fechou". Somar os dois apagaria justamente o que a triagem mede. O carimbo é sempre explícito (tool), nunca inferido do texto da conversa — a métrica vira dinheiro e um palpite ali é um número que o cliente confere e não bate.
9. **Contagem de leads**: toda contagem de negócio filtra `isTest: false`. O admin (`src/modules/admin/service.ts`) mostrava o total SEM esse filtro e divergia de /relatorios para a mesma conta; hoje o `_count` leva `where`. Se dois lugares mostrarem números diferentes, compare primeiro **janela** (a home usa 7/30 dias, o admin é histórico total) e depois `isTest`.
10. **Paleta**: nunca reordenar `CHART_LIGHT`/`CHART_DARK`/as variáveis `--chart-N` sem rodar `node scripts/validate_palette.js "<hex,...>" --mode light/dark` do skill dataviz de novo — a ordem atual (iris, warn, success, signal, violeta) foi escolhida especificamente para separar dois tons que ficavam indistinguíveis (ΔE abaixo do piso) na ordem antiga.

## Como estender

### Novo gráfico Operacional

1. Tipo + série nova em `computePeriodReport` (`service.ts`) — reuse o padrão de buscar timestamps com `select` estreito e bucketar em memória (não há `_lib`/SQL cru nesta seção).
2. Variante em `ChartPanel.tsx`: incluir em `Variant`, `DESCRIPTIONS`, `chart()`, `table()` e `sources()`.
3. (Opcional) seção nova no CSV em `export/route.ts`.
4. Posicionar o `ChartPanel` na `page.tsx`.
5. Se o gráfico usa cor categórica (mais de 2 séries por identidade, não por polaridade), usar `chartColor(index)` de `palette.ts` — nunca um hex novo (regra 8).

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

### Revisão mensal de ROI

- Admin carrega a competência solicitada (`mes`); sem parâmetro, abre a última revisão existente da clínica, com fallback para o mês anterior, limitado ao cadastro. Um pedido anterior à criação abre o primeiro mês da conta, com aviso.
- Mensalidade ausente vem do preço negociado da conta ou do plano atual, com origem para conferência. Valores existentes e zero são preservados; snapshots fechados não são atualizados pelo preço atual.
- Importação oferece todos os agentes ou uma seleção persistida em `assumptions.agentIds`. Prévia de leitura, validada no servidor, carrega métricas atuais/anteriores e mantém correções manuais. O comparativo usa o mesmo escopo; não reaproveita totais de um snapshot de escopo diferente.
- Horários cadastrados de `schedule_meeting` aparecem como sugestão com origem; grades de agentes selecionados são unidas no mesmo fuso. A classificação depende da confirmação do expediente humano. Nunca importar horários padrão de configuração vazia nem inventar ticket/conversão/custo.
- O documento `MonthlyRoiReport.assumptions` conserva as premissas originais e guarda `metricOverrides: { current, previous }` como chave adicional. `parseMonthlyAssumptions` lê apenas premissas; `parseMonthlyOverrides` valida as correções separadamente. Isso é compatível com registros existentes, sem alteração de schema.
- Dados automáticos de mensagens, agenda e Clinicorp preenchem o editor. Só campos alterados viram correção persistente; restaurar um campo remove sua correção. Correções nunca passam para o próximo mês quando se copiam premissas.
- Cada contagem, tempo de resposta, horas assumidas, procedimento e pico pode ser corrigido. Receita/economia/ROI continuam derivados pela regra definida, sem permitir que uma porcentagem arbitrária substitua a fórmula. Presenças fora do expediente devem bater com a soma por procedimento antes do fechamento.
- O comparativo usa o snapshot fechado do mês anterior quando existir. Uma correção do comparativo é local à revisão atual. Reabrir uma revisão preserva os indicadores que estavam no snapshot; relatórios já enviados continuam preservados.
- `updatedAt` identifica a revisão carregada pelo formulário e protege contra sobrescrita concorrente. Correções entram na auditoria e no snapshot de fechamento; o painel e o PDF avisam quando existem ajustes manuais.
- PDF: imagens locais em `public/brand`, tinta preta/cinza, uma página A4. Nunca depende de uma chamada externa para buscar logos ao exportar.
- **Fazer com I.A** na revisão administrativa em rascunho abre ajuda em `SidePanel`. Usa a cadeia e as credenciais de Admin → IA, explica campos e propõe preencher dados informados. `monthly-ai.ts` valida campos/unidades e mescla sugestões; `monthly-ai-service.ts` envia somente agregados e a revisão atual, sem conversas de pacientes. `ai-actions.ts` exige SUPERADMIN, valida agentes do tenant e limita perguntas. As sugestões são aplicadas por botão, preservam os outros campos e precisam de **Salvar revisão**. Não alteram fórmula/publicação/presença; expediente sugerido perde a confirmação. Mudanças posteriores no formulário invalidam a sugestão. Contrato detalhado na P-79.

- Dev server: `npm run dev` (porta 3001).
- Typecheck: `npx tsc --noEmit`.
- Lint da seção: `npx eslint "src/app/(dashboard)/relatorios" "src/modules/reports" "src/components/charts"`.
- Paleta: `node scripts/validate_palette.js "<hex,hex,...>" --mode light` e `--mode dark` (script do skill dataviz) → espera **ALL CHECKS PASS** nos dois modos antes de mudar qualquer cor categórica.
- Smoke: `Invoke-WebRequest http://localhost:3001/relatorios -MaximumRedirection 0` → espera **307**.
