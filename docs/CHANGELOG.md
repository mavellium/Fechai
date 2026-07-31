# Changelog

Uma linha por milestone concluído (mais recente no topo).

## Layout de `/inicio`, `/conversas` e `/whatsapp` — 2026-07-31

Proposta e wireframes em `docs/proposta-layout-painel-2026-07.md`. A revisão de
UI anterior padronizou os componentes; este passe é sobre **layout, densidade e
estado**: as três telas eram uma coluna de cards de mesmo peso que não mudava
quando o estado da conta mudava.

- **`/conversas` virou caixa de entrada de verdade.** Três painéis (lista ·
  histórico · contexto do lead), cada um com scroll próprio dentro da altura da
  viewport — antes a página inteira rolava e o cabeçalho "com quem estou
  falando" saía de vista numa conversa longa. Novos: busca por nome/telefone,
  agrupamento por urgência ("Precisam de você" no topo, depois Hoje / 7 dias /
  Antes), "carregar mais" (o `take: 50` cortava em silêncio), separador de dia e
  mensagens seguidas do mesmo autor coladas. No celular aparece um painel por
  vez, comandado pelo `?id=` que já existia na URL.
- **Fim do beco sem saída do handoff** (pendência 4 da revisão anterior): a
  terceira coluna traz dados do lead (telefone, primeiro contato, agente que
  atendeu, follow-up) e ações — `resolveConversation`/`reopenConversation`
  (`updateMany` com `tenantId` no `where`) e "Responder no WhatsApp" via
  `wa.me`. O lead do sandbox (telefone literal `sandbox`) não ganha link
  quebrado: ganha explicação.
- **Sandbox saiu do fluxo da página** e virou `<dialog>` nativo acionado pelo
  cabeçalho — ocupava card permanente numa tela sobre conversas reais.
- **`/whatsapp` passou a ser orientada a estado.** Desconectada: QR gerado
  sozinho ao abrir (era um clique a mais para a única coisa que a pessoa veio
  fazer), grande, com cronômetro de validade — o código expirava em silêncio e a
  tela ficava dizendo "aguardando" para sempre, mesmo defeito do bug nº 13 por
  outro caminho. Conectada: painel de saúde (desde quando, mensagens recebidas
  nos últimos 7 dias), sem código nenhum. O snippet do site deixou de ser card
  irmão do WhatsApp e virou item da seção "Outros canais" (Site · Instagram em
  breve), que dá lugar para o produto crescer.
- **`/inicio` tem duas fases.** Em setup, só o **próximo** passo tem ação (eram
  seis botões "Começar" idênticos competindo, contra a regra de uma ação
  primária por tela); concluídos colapsam num `<details>`. Já no ar, a home vira
  resumo: faixa de saúde (agente · WhatsApp · plano/uso), números por período
  com variação contra a janela anterior, sparkline de mensagens por dia,
  "Precisa de você" e últimas conversas.
- **Bug encontrado no caminho**: o passo `site` do checklist tinha `done: false`
  fixo ("habilitado no Milestone 5"), então `allDone` era **inalcançável** — o
  progresso nunca chegava a 100% e a conta ficava presa em modo configuração
  para sempre. Virou `optional: true`, com `requiredSteps()`/`setupComplete()`
  em `modules/tenants/onboarding.ts`.
- **`PanelShell`**: o wrapper do `main` virou `flex min-h-full flex-col`, o que
  dá altura definida para uma tela pedir `flex-1` e ocupar a viewport. Telas
  normais não mudam.
- Novos: `lib/format.ts` (tempo relativo pt-BR, rótulo de telefone, `wa.me`),
  `computeHomeSummary()` em `modules/reports/service.ts` (janela + comparação
  com o período anterior; `computeTenantReport` continua "desde o início" para
  `/relatorios`), `Stat` com `delta` e `compact`.
- Verificado: `tsc --noEmit` e `eslint` limpos, `next build` verde (24/24). No
  navegador, contra o banco de dev: `/inicio` nas duas fases, `/conversas`
  (lista, detalhe, busca sem resultado, filtro vazio, lead de sandbox) e
  `/whatsapp` desconectada. **Não verificado**: `/whatsapp` conectada e a leitura
  real do QR — nenhuma conta de teste tem número conectado.

## Fix: rodapé da sidebar (botão minimizar) sumindo em telas compridas — 2026-07-30

- **Causa real do "o botão de minimizar não aparece"**: não era cache de
  navegador nem bug do componente — era layout. `PanelShell` era
  `flex min-h-screen` (linha) com a `Sidebar` e o `main` como irmãs; com
  `min-h-screen`, a altura do container cresce junto com o conteúdo da
  página, e por `align-items: stretch` (padrão do flex) a sidebar esticava
  para acompanhar essa altura total — não a da viewport. Em telas com
  conteúdo comprido (`/configuracoes`, com checklist + form de feedback), o
  rodapé da sidebar (agora com o botão de minimizar) ficava empurrado bem
  abaixo da dobra, exigindo rolar a **página inteira** pra aparecer.
- **Fix**: `PanelShell` virou `h-screen overflow-hidden` (em vez de
  `min-h-screen`) — a casca fica travada na altura da viewport, só o `main`
  rola internamente (`overflow-y-auto`). Sidebar e header ficam sempre
  visíveis, padrão de app shell. `Sidebar.tsx` ganhou `h-full` explícito (em
  vez de depender do stretch implícito) + `overflow-y-auto` defensivo, caso
  algum painel ganhe nav longa o bastante para não caber na viewport.
- Verificado: `tsc --noEmit` e `eslint` limpos.

## Sidebar minimizável no desktop (dashboard + admin) — 2026-07-30

- **Novo `Sidebar.tsx`** (client) substitui o `<aside>` estático que vivia
  dentro de `PanelShell.tsx`: mesma sidebar de sempre, agora com botão
  minimizar/maximizar no rodapé (`PanelLeftClose`/`PanelLeftOpen`). Minimizada,
  vira uma coluna só de ícones (`w-16`) com `title` (tooltip nativo) e label
  em `sr-only` por item — continua com nome acessível, só não ocupa espaço
  visual. `ShellNav` ganhou a prop `collapsed` para isso; a gaveta mobile
  (`MobileNav`) não usa, sempre mostra os labels.
- **Preferência em `localStorage`**, lida via `useSyncExternalStore` — não
  `useEffect` + `setState`, que dispara `react-hooks/set-state-in-effect`
  (a mesma regra que pegou o bug real do `NewAccountForm`, ver revisão de
  UI do painel). `useSyncExternalStore` é o mecanismo do próprio React para
  sincronizar com uma fonte fora do React sem esse problema: usa
  `getServerSnapshot` (sempre "aberta") na hidratação e troca para o valor
  real do client sem descompasso.
- Transição de largura em 200ms `ease-out`, com `motion-reduce:transition-none`.
- Verificado: `tsc --noEmit` e `eslint` (projeto inteiro) limpos; `/inicio` e
  `/admin/contas` seguem respondendo (307 de auth, sem erro de servidor).
  **Não verificado em navegador**: clicar o botão e ver a sidebar de fato
  encolher/expandir — mesma limitação de ambiente das entradas anteriores
  (sem Playwright/chromium-cli aqui).

## Ícones na navegação do painel (dashboard + admin) — 2026-07-30

- **`ShellNav`/`NavItem`** ganhou campo `icon`, usado pelos dois `NAV`
  (`(dashboard)/layout.tsx`, `(admin)/layout.tsx`) e renderizado uma vez em
  `ShellNav.tsx`, que já é compartilhado pela sidebar desktop e pela gaveta
  mobile (via `PanelShell`/`MobileNav`) — corrigir num lugar só resolveu os
  dois painéis e os dois breakpoints.
- Dashboard: Início `Home`, Agentes `Bot`, WhatsApp `MessageCircle`, Conversas
  `MessagesSquare`, Relatórios `BarChart3`, Configurações `Settings`.
  Admin: Contas `Building2`, IA `Cpu`, Feedbacks `Star`.
- **Fix em produção do primeiro passe**: `NAV` nasce em `layout.tsx` (Server
  Component) e ia para `ShellNav` (Client Component) com o **componente**
  lucide direto no array (`icon: Home`) — React rejeita passar
  função/objeto-com-`render` de Server para Client Component ("Only plain
  objects can be passed..."). Corrigido para o layout mandar só o **nome**
  (`icon: "Home"`, string, serializável) e o `ShellNav` resolver o componente
  num mapa `ICONS` local.
- Verificado: `tsc --noEmit` e `eslint` limpos, rota volta a responder
  (307 de auth, não mais 500).

## Navbar da landing: menu mobile + ícones + acessibilidade — 2026-07-30

- **Ícones nos links** (`lucide-react`, mesma lib já usada no resto do produto):
  `Workflow`/`Zap`/`Layers`/`CircleHelp` nos 4 links de seção, `LogIn` em
  "Entrar", `UserPlus` em "Criar conta" — desktop, drawer mobile e rodapé do
  drawer. `aria-hidden` neles (o texto do link já rotula a ação; duplicar via
  leitor de tela seria ruído).
- **Sem navegação no celular** (mesma classe de bug já corrigida no painel em
  28/07): `nav` dos links de seção era `hidden md:flex` sem nenhum substituto
  abaixo de 768px — quem abria a landing pelo celular não via "Como funciona",
  "Ações", "Planos" nem "FAQ". Novo drawer mobile no próprio `Navbar.tsx`
  (mesmo padrão do `MobileNav` do painel: `<dialog showModal()>`, ícones
  `Menu`/`X` do lucide-react, fecha ao clicar num link/CTA), com os CTAs
  "Entrar"/"Criar conta" repetidos no rodapé da gaveta.
- **Contraste abaixo do piso**: os links de seção usavam `text-white/50`
  sobre `ink` — mesmo problema (~3.9:1, reprova AA) já corrigido no
  `ShellNav` do painel, que fixou o piso em `/60`. Alinhado ao mesmo piso.
- **`focus-visible` ausente** no logo, nos 4 links de seção e no link
  "Entrar" (desktop e dentro do drawer) — navegável por mouse, invisível por
  teclado. Ganharam o mesmo anel (`ring-iris` + offset `ink`) usado no resto
  do produto.
- **`text-[11px]` → `text-micro`**: os links da navbar ainda usavam o valor
  solto que o token (`--text-micro`, criado na revisão do painel) existe
  justamente para eliminar.
- Verificado: `tsc --noEmit` e `eslint` limpos. **Não verificado em
  navegador**: abrir/fechar a gaveta em ~375px — sem `chromium-cli`/Playwright
  neste ambiente para captura de tela; pendente de um passe manual.

## Revisão de UI do painel (dashboard + admin) — 2026-07-28

> Relatório completo: [revisao-ui-painel-2026-07.md](./revisao-ui-painel-2026-07.md)

- **Navegação no celular** (era o buraco maior): a barra lateral era `hidden md:flex` sem nenhum substituto abaixo de 768px — no telefone dava para entrar no painel e não dava para sair da primeira tela. Novo `MobileNav` (gaveta com `<dialog showModal()>`: foco preso, `Esc` e devolução de foco vêm do navegador). Os dois layouts, que eram cópias quase idênticas já divergindo, viraram um `PanelShell`.
- **Superfície por atributo**: `PanelShell` marca `data-surface="dark"` uma vez e o `globals.css` declara `@custom-variant panel (&:where([data-surface="dark"] *))`. Os primitivos trazem a variante embutida, então sumiram os overrides manuais (`className="border-white/20 bg-transparent text-white/70 …"`) repetidos em 4 telas. Confirmado no CSS compilado (46 regras, inclusive compostas).
- **Bugs corrigidos**: `form.reset()` no corpo do render apagava o que a pessoa digitava (`KnowledgeManager`); bolhas de chat invertidas entre `/conversas` e o sandbox (lead e agente trocados de lado); chat sem rolagem automática nas duas telas; `<select onChange={grava}>` no admin gravava plano/status intermediários a cada seta do teclado; suspender conta e remover documento executavam sem confirmação; `NaN%` na barra de progresso com catálogo vazio; `pending` global desabilitava os 5 toggles de ação de uma vez; falha ao remover documento sumia em silêncio (`void` no retorno); `role="radiogroup"` com `<li>` no meio quebrava o grupo no `ModelPicker`; status do WhatsApp só atualizava com clique manual (agora faz polling de 5s enquanto o QR está na tela, com teto de 2min).
- **Acessibilidade**: labels associadas via `Field`/`fieldProps` (campos que só tinham `placeholder` como rótulo); `role="switch"` no lugar de `aria-pressed`; nota por estrelas virou `fieldset` com radios nativos (setas do teclado funcionam, e "1 estrela" no singular); `focus-visible` nos ~10 controles feitos à mão que não tinham; erros/sucessos em `Alert` com `role="alert"`/`role="status"`; contraste do texto pequeno subiu de `white/35–40` (≈3.4–3.9:1, reprova AA) para piso `white/55`; skip link; `scope`/`caption` na tabela do admin e região rolável focável; status crus (`warm`, `pending_qr`) traduzidos.
- **Estados que faltavam**: `loading.tsx` nos dois grupos (não existia nenhum, com 9 rotas consultando o Prisma), `error.tsx` no admin (+ `digest` e ação de contato no do dashboard), e estado vazio **com próximo passo** em conversas, documentos, relatórios, contas e feedbacks.
- **Padronização — segue shadcn/ui, sem dependência nova**: o projeto já era shadcn (`cn()` com clsx+tailwind-merge, CVA, tokens no `@theme`, lucide), só que com 4 primitivos para uma superfície que precisava de ~18 — a diferença virava HTML solto por tela. Catálogo completado: `alert`, `badge`, `button` (+`loading`, `ButtonLink`), `confirm-dialog`, `copy-button`, `empty-state`, `field`, `filter-tabs`, `loading-dots`, `page-header`, `segmented-control`, `select`, `skeleton`, `stat`, `switch`, + `chat/ChatBubble`, `chat/ChatLog`, `shell/PanelShell`, `shell/MobileNav`, `shell/PanelError`. MUI/AntD foram descartados por trazerem tema próprio (duas fontes de verdade para cor); Radix, porque o `<dialog>` nativo já cobria o que faltava.
- **Duplicatas eliminadas**: 3 implementações de campo-com-label → 1 (`LabeledField` de `(auth)` e `Field` do onboarding agora reexportam o mesmo); 3 selects → 1; 2 cópias de copiar-para-área-de-transferência → 1; ~8 pílulas de status → `Badge`; 7 cabeçalhos → `PageHeader`; 2 grupos de filtro → `FilterTabs`; 3 bolhas de chat (2 discordando) → `ChatBubble`. Removido `(dashboard)/_components/Placeholder.tsx` (código morto, sem importador).
- **Raio e tipografia micro viraram token** (`--radius-control` 8px, `--radius-surface` 12px, `--text-micro` 11px no `@theme`). O produto misturava `rounded-md`/`lg`/`xl`/`2xl` na mesma tela e usava `text-[9px]`/`[10px]`/`[11px]` para o mesmo papel — como eram valores soltos, não havia um lugar para corrigir. Agora qualquer `rounded-[Npx]` ou `text-[Npx]` no código é desvio detectável.
- **Fix na seta do `<select>`**: era um `<svg>` irmão dentro de um wrapper `relative` que não recebia o `className` — a largura ia para o `<select>` e o wrapper ficava com 100%, então em qualquer select estreito (`w-32` na tabela de contas) a seta descolava do campo. Virou `background-image` na classe `.ui-select`: o `<select>` é um elemento só e `className` se comporta como em qualquer outro campo.
- Cabeçalho de `/agentes` renomeado de "Configuração do agente" para "Seu agente" — colidia com `/configuracoes` no menu. **Rota inalterada.**
- Verificado: `npm run build` verde (24/24) e `npm run lint` verde — o lint **estava vermelho antes** deste passe, com 2 erros pré-existentes (`setState` em efeito no `NewAccountForm`; `window.location.href =` no `PlanPicker`), ambos corrigidos. **Não verificado em navegador**: gaveta mobile, diálogos de confirmação, polling do WhatsApp e rolagem automática — pendente de um passe manual.

## Reorganização do menu do painel do cliente — 2026-07-28

- **`/configuracao` → `/agentes`** (nav "Agentes"): mesma tela (persona, base de conhecimento, ações), só rota e label renomeados para não colidir com a nova `/configuracoes`. `revalidatePath` (`agentes/actions.ts`, `onboarding/actions.ts`) e os `href` do checklist de onboarding (`src/modules/tenants/onboarding.ts`) atualizados junto.
- **Nova `/configuracoes`** (nav "Configurações"): junta o que antes eram as rotas `/status` (checklist "Sua configuração") e `/feedback` (form de feedback) numa única tela, cada um em seu card. As duas rotas antigas foram removidas — nada mais linkava para elas fora do nav.
- **Seção "Integrações" retirada** da visão do tenant: mostrava quais env vars (Stripe, Evolution, Redis, IA) estão configuradas, informação de configuração de plataforma sem utilidade para o cliente final. `integrationChecks()` (`src/lib/health.ts`) não foi removida, só deixou de ser chamada por essa página — fica disponível caso um painel admin precise dela.
- Verificado: `tsc --noEmit` e `eslint` limpos após o rename (as duas rotas antigas não deixaram referência solta).

## Onboarding guiado para contas novas — 2026-07-28

- **Wizard de 4 passos em `/onboarding`** (boas-vindas → configurar o atendente → o que ele resolve → conectar), numa única rota: os passos são estado do client component, sem navegação entre URLs. Stepper com barra de progresso, `%` e passos já visitados clicáveis para voltar.
- **Passo 2 com prévia ao vivo**: um chat simulado (`ChatPreview.tsx`) reflete nome, tom de voz e objetivo enquanto o usuário escolhe. É simulação local — não chama a IA; o sandbox real segue em `/conversas`.
- **Passo 3 — processos**: 4 opções pré-definidas (atender, vender, resolver problemas, agendar) + campo livre. Cada processo mapeia para automações do `agent-engine`, e a seleção respeita o teto de ações do plano (`maxActiveActions`), avisando quando algo fica de fora em vez de estourar silenciosamente.
- **Passo 4 — integração**: snippet de instalação no site com botão de copiar e conexão do WhatsApp com QR + status (reaproveita as server actions de `/whatsapp`). Nenhum dos dois trava a conclusão.
- **Progresso persistido**: autosave com debounce de 800ms grava `onboardingStep` + `onboardingDraft` no `Tenant`; ao voltar, o wizard reabre no passo em que parou com as respostas preenchidas. `parseDraft()` tolera Json nulo ou corrompido.
- **Validação por passo** no client (libera o "Continuar") **e** revalidada na server action antes de gravar — a UI não é a única linha de defesa.
- **Guard de rota** no layout de `(dashboard)`: enquanto `onboardingCompleted` for falso, qualquer página do painel redireciona para `/onboarding`. Fica **depois** da checagem de conta suspensa (conta suspensa vê o aviso, não o wizard), e `/onboarding` mora fora do grupo `(dashboard)` para não haver loop. `SUPERADMIN` nunca vê o wizard (`requireOwner()` o manda para `/admin/contas`).
- **Sem estado paralelo**: ao concluir, as respostas viram `PersonaAnswers` + `TenantAction`s numa transação, então tudo segue editável em `/configuracao`. Para isso `PersonaAnswers` ganhou `agentName` (novo campo no formulário de persona) — sem ele, salvar a persona em `/configuracao` apagaria o nome do agente.
- Schema: `Tenant.onboardingCompleted` / `onboardingStep` / `onboardingDraft`. Contas pré-existentes receberam backfill para `true` e o `seed.ts` já cria os tenants de exemplo concluídos, então ninguém é jogado no wizard retroativamente.
- Verificado ponta a ponta: conta nova é desviada de `/inicio` e `/configuracao` para `/onboarding`; superadmin cai em `/admin/contas`; conta antiga entra direto no painel; retomada reabre no passo 3 com rascunho e checkboxes corretos; após concluir, `/onboarding` devolve para `/inicio` e a persona aparece em `/configuracao`. 26 asserções das funções de domínio (validação, limite de plano, `parseDraft`, composição do prompt) passando.

## Admin cria contas (qualquer papel, qualquer plano) — 2026-07-25

- `/admin/contas` ganhou o painel **Nova conta**: nome do tenant, e-mail, **tipo de conta** (Cliente/owner ou Superadmin) e **plano** (FREE→BUSINESS). Reaproveita `createTenantWithOwner`, então a conta já nasce com `AgentConfig`, instância de WhatsApp e as 5 ações padrão — a pessoa entra pelo `/login` e usa.
- **Senha opcional**: em branco, o sistema gera uma provisória de 14 caracteres (alfabeto sem `0/O/1/l/I`) e mostra **uma vez** com botão de copiar. Preenchida, usa a do admin. Nunca é relida depois — só o hash bcrypt fica no banco.
- Aviso explícito ao escolher Superadmin (enxerga/edita todas as contas) e badge `admin` na tabela para distinguir conta de plataforma de conta de cliente.
- E-mail duplicado é rejeitado com mensagem clara. `createAccount` valida com zod e passa por `requireSuperadmin`.
- Verificado ponta a ponta: OWNER criado loga com a senha gerada e cai em `/inicio` (bloqueado em `/admin`); SUPERADMIN criado cai em `/admin/contas` (bloqueado em `/inicio`); duplicado recusado; tenant provisionado completo.

## Rename: o produto agora se chama **fechai** — 2026-07-25

- Wordmark `fechai.` (minúsculo, ponto em `signal`) nos 5 shells: landing (Navbar/Footer), dashboard, admin e auth.
- `metadata` da raiz com `title.template` (`%s · fechai`) e `applicationName`; `package.json` → `"fechai"`; header do `schema.prisma`; rodapé da landing.
- `README.md` reescrito (era o boilerplate do create-next-app): o que é, como rodar, contas do seed, aponta para `docs/INDEX.md`.
- Regra registrada em `CONVENTIONS.md` e `INDEX.md`: **fechai** é o nome do produto; **agente** continua sendo o termo de domínio da IA (`agent-engine`, `AgentConfig`, `runAgentTurn`, "o agente responde") e não foi renomeado.
- Infra não mexida de propósito: containers `saas_postgres`/`saas_redis` e volumes `teste_pgdata`/`teste_redisdata` mantêm o nome — renomear recriaria os volumes e apagaria o banco local.

## Fonte corrigida + camada de IA trocável (Gemini) + config no admin — 2026-07-24

- **Fix de fonte (raiz)**: `--font-sans`/`--font-display` referenciavam `--font-satoshi`/`--font-clash-display`, que nunca foram definidas (as fontes da Fontshare não chegaram). `var()` sem fallback em custom property indefinida invalida a declaração inteira (IACVT), então `html`/`body` caíam no serif padrão do navegador — e como `--font-mono` funcionava, o resultado era a mistura de fontes visível na dashboard. Fallback movido para dentro do `var()`: `var(--font-satoshi, var(--font-jakarta))`. Confirmado no CSS compilado.
- **Camada de IA** (`src/modules/ai/`): contratos + erros tipados (`AiError` com `rate_limit`/`quota_exceeded`/`auth`/`provider` e mensagem PT-BR para o lead), adapters **Gemini** (REST, sem SDK) e OpenAI, catálogo de modelos com limites/preços, e `getLLMProvider()` resolvendo o modelo ativo do banco. O `agent-engine/llm.ts` foi removido — nada fora de `providers/` importa SDK de provedor.
- **Embeddings/RAG também no Gemini** (`gemini-embedding-001` com `outputDimensionality: 1536` para casar com a coluna pgvector, normalizado). O RAG passa a funcionar sem chave da OpenAI.
- **Limites do free tier tratados**: 429/`RESOURCE_EXHAUSTED` vira `rate_limit` ou `quota_exceeded` (distingue por minuto vs. por dia); ao estourar a cota o lead recebe mensagem clara e a conversa é marcada `needsHuman` em vez de morrer em silêncio.
- **Novo `/admin/ia`**: modelo ativo (provedor, credencial, embeddings, quem trocou) + troca entre modelos do catálogo com tier gratuito/pago, limites e custo por 1M. Persistido em `AiSetting` (linha única) — sem env var, sem deploy; cache de 30s.
- `docs/pesquisa-llm-2026-07.md`: comparativo de custo/escalabilidade com recomendação (ficar no Gemini; migrar para Flash pago no primeiro cliente sério).

## Redesign dos painéis (usuário + admin) + separação por role — 2026-07-18

- **Mundos separados**: login agora decide o destino pelo role (superadmin → `/admin/contas`; owner → `/inicio`). Novo guard `requireOwner` em `src/lib/session.ts` expulsa superadmin do dashboard de tenant (e `requireSuperadmin` já fazia o inverso) — verificado via HTTP nas duas contas do seed.
- **Shell escuro editorial** nos dois painéis (mesma identidade da landing): sidebar `ink` com o wordmark, nav em mono uppercase com barra `signal` no ativo (`components/shell/ShellNav.tsx`), header com e-mail em mono, glow sutil no conteúdo. Admin tem selo "painel do admin" e glow coral.
- **Páginas do usuário** refeitas: início (checklist numerado com progresso `signal`), configuração (persona/base/ações com toggles que acendem `iris`), whatsapp (QR em card branco, snippet mono), conversas (filtros pill, lista com hover, bolhas de chat) + sandbox escuro, relatórios (stat tiles com display gigante), status (checks `success`), feedback (estrelas `warn`).
- **Páginas do admin** refeitas: contas (tabela escura, selects nativos escuros, badges ativo/suspenso, busca) e feedbacks (cards + filtros pill).
- Card/Placeholder/error boundary migrados para o tema escuro. Zero classes `gray-*`/`amber-*`/`red-*` nos painéis.

## Experiência de scroll + UX do auth — 2026-07-18

- **Âncoras do menu**: `scroll-behavior: smooth` + `scroll-padding-top: 76px` (CSS nativo) — clique no menu rola suave e a seção não fica cortada sob o header. Scrollspy no navbar (link da seção visível acende com sublinhado `signal`).
- **Barra de progresso de leitura** no topo (Motion `useScroll` + spring) e **parallax sutil** no telefone do hero e no headline do CTA (`Parallax.tsx` — Motion apenas lê o scroll nativo, sem controlá-lo). Reveals agora revelam em cascata (stagger 70ms por lote).
- **Auth elevado**: painel direito virou a identidade escura com a **demo ao vivo do produto** (reuso do `HeroChat` — a conversa se atende sozinha enquanto a pessoa preenche o form), grade técnica + glow; autofocus no primeiro campo; `FadeIn` na entrada do form; wordmark consistente.
- Tudo respeita `prefers-reduced-motion` (progress some, parallax estático, reveals visíveis, chat completo estático).

## Fix: travamento de scroll na landing + botão do header — 2026-07-18

- **Lenis e GSAP removidos** (desinstalados): o smooth scroll do Lenis travava a rolagem quando a altura da página mudava (accordion do FAQ) — a página parava antes do CTA final. Rolagem agora é 100% nativa; reveals de scroll refeitos com IntersectionObserver + CSS (`[data-animate] .reveal` em `globals.css`). Sem JS/reduced-motion, tudo visível.
- Botão "Criar conta" do navbar ajustado ao tema escuro (outline branco translúcido, sem cor sólida fora do padrão).
- `docs/animations.md` atualizado (regra: não reintroduzir smooth-scroll de biblioteca).

## Redesign editorial da landing + hero corrigido — 2026-07-18

- Direção nova ("a conversa é o produto"): landing editorial escura (`ink`) com display gigante, labels em `font-mono`, glows de `iris`/`signal` e grade técnica sutil — sai o layout claro genérico de SaaS.
- **Hero corrigido**: o `HeroShowcase` (GSAP com cenas absolutas que sobrepunham) foi **removido**; entrou o `HeroChat` — conversa de WhatsApp que se atende sozinha, sequencial (Motion/AnimatePresence + máquina de estados), com chips de ação ("Lead registrado", "Horário agendado") e fecho em `signal`. Sem empilhamento absoluto → sem sobreposição possível; reduced-motion mostra a conversa completa estática.
- Seções refeitas no idioma editorial: Problema (pull-quote com label vertical), ComoFunciona (linhas numeradas estilo índice), Ações (banda ink com hover-glow + célula "novas ações a caminho"), Planos (destaque = card ink invertido, sem ring genérico), ProvaSocial (faixa honesta), CTA final (display 6xl + glow signal). Navbar/Footer escuros.
- Verificado: build verde, landing 200 com todo o conteúdo novo, zero resquício do hero antigo.

## Refatoração de identidade visual + front-end elevado — 2026-07-18

- **Refatoração de identidade visual aplicada**: tokens `ink/paper/iris/signal/success/neutral` no `@theme` (Tailwind v4), zero cores fora da paleta em todo o `src/`; tipografia `font-display`/`font-sans`/`font-mono` (Clash Display/Satoshi via fallback Space Grotesk/Jakarta até os arquivos da Fontshare chegarem; JetBrains Mono ativo); botão `variant="cta"` (signal) restrito a conversão.
- **Stack de animação** (conforme skill `design-ui`): GSAP+Lenis **só na landing**; Motion (`motion/react`) na UI; documentado em `docs/animations.md`.
- **Assinatura da marca**: `TypingToCheck` ("digitando → check") em botões de auth, bolha do sandbox e painel do auth; keyframes CSS próprios.
- **Landing anti-"cara de IA"** (auditoria da seção 8 da skill): hero novo = demonstração do produto em GSAP timeline (formulário autopreenchendo → ações ligando → QR+snippet → conversa terminando em check coral + "Horário agendado"), autoplay em loop ~10.5s, frame estático com reduced-motion; seção "O problema" concreta; ComoFunciona em 4 passos numerados; ações reais do catálogo; **depoimentos fictícios removidos** (prova social honesta); 1 CTA `signal` por tela; reveals de scroll (`.reveal`).
- **Auth split-screen**: form à esquerda (labels visíveis, validação em tempo real com mensagens específicas, mostrar/ocultar senha, magic link visível como "em breve", micro-copy de confiança), painel de marca à direita; transição fluida para `/planos` (FadeIn).
- Verificado: build verde, landing/login/cadastro 200 com conteúdo novo, `prefers-reduced-motion` respeitado em GSAP/Lenis/Motion/CSS, mobile via grid responsivo (split empilha, hero empilha).
- Pendência: arquivos reais de `brand-guide.md`, `logo.svg`, `icon-mark.svg`, `favicon.svg` e fontes Fontshare ainda não estão no repo — estrutura pronta para recebê-los.

## Milestone 8 — Polimento de autoatendimento — 2026-07-18

- **`/status`** (dashboard): saúde da configuração do tenant (persona, base, ações, WhatsApp) + integrações (OpenAI, Stripe, Evolution, Redis) via `src/lib/health.ts`. Link no menu.
- **`GET /api/health`**: verifica o banco (200/503) para monitoramento de deploy.
- **Conta suspensa**: layout do dashboard bloqueia o app e orienta contato (com botão Sair).
- **Estados de erro**: `error.tsx` (boundary com "tentar de novo") no dashboard; `not-found.tsx` global (404). WhatsApp desconectado já tinha botão de reconectar (M5).
- `ARCHITECTURE.md` revisado refletindo o que foi construído; anotações "(Milestone X)" removidas.
- **Critério atendido:** erros tratados, página de status/health disponível, docs finais coerentes. Verificado: build verde (22 rotas); `/api/health`→503 (sem DB, sem crash), `/status`→307, 404 renderiza.

> **MVP concluído** — 8/8 milestones. Para rodar tudo ao vivo: `npm run db:up && npm run db:push && npm run db:seed && npm run dev` (+ `npm run worker`), com `.env` preenchido (OpenAI/Stripe/Evolution opcionais — o app degrada sem eles).

## Milestone 7 — Painel do Admin + Feedback — 2026-07-18

- **Módulo `feedback/`**: `createFeedback` (cliente, tenant-scoped), `listFeedbacks` + `setFeedbackStatus` (admin). **`/feedback`** no dashboard: form com nota (estrelas) + mensagem → server action grava `Feedback`.
- **Módulo `admin/`**: `listTenants`/`getTenantDetail`/`setTenantStatus`/`adminSetPlan` (cross-tenant, SUPERADMIN).
- **Rota `(admin)/`** protegida por `requireSuperadmin`: `admin/contas` (lista tenants + busca; trocar plano; suspender/reativar) e `admin/feedbacks` (lista + filtro por status; mudar status). Server actions revalidam e re-checam SUPERADMIN.
- Docs: READMEs de `feedback` e `admin`.
- **Critério atendido:** superadmin loga, vê todos os tenants e lê feedbacks sem acessar o banco. Verificado: build verde (20 rotas); gating `/admin/contas`, `/admin/feedbacks`, `/feedback` → 307 `/login`. _(Distinção OWNER→/inicio e dados reais exigem Postgres + login como superadmin do seed.)_

### Próximos passos → Milestone 8 (Polimento de autoatendimento)

- Estados de erro (WhatsApp desconectado → reconectar); página de status/health do tenant; revisão final de `ARCHITECTURE.md`.

## Milestone 6 — Follow-up automático + Relatórios — 2026-07-18

- **Worker `workers/follow-up-worker/`** (BullMQ + Redis): job repetível `scan` (`upsertJobScheduler`, padrão 15 min) → `scanAndSendFollowUps` varre conversas sem resposta (dos tenants com `follow_up` ativo), envia follow-up via WhatsApp se conectado, grava a mensagem e marca `followUpSentAt` (não reenvia). Regra pura `isEligible` isolada e testada. Script `npm run worker`.
- **Módulo `reports/`**: `computeTenantReport(tenantId)` → conversas, leads, quentes, agendamentos, precisam-humano, follow-ups enviados e taxa de resposta (conversas com lead 2+ mensagens).
- **`/relatorios`**: grid de cards com os números reais do tenant.
- Docs: READMEs de `reports` e do worker; `worker` no package.json.
- **Critério atendido:** lead sem resposta após o limiar recebe follow-up (uma vez); dashboard mostra números reais. Verificado: build verde; unit test de `isEligible` (regra de disparo). _(Disparo real requer Redis + Postgres + WhatsApp conectado.)_

### Próximos passos → Milestone 7 (Painel do Admin + Feedback)

- Rota `(admin)/` protegida por `SUPERADMIN` (`requireSuperadmin`): `contas/` (lista tenants, suspender/reativar, trocar plano) e `feedbacks/` (lista + filtro/status).
- Formulário de feedback no dashboard do cliente (`/feedback`) gravando `Feedback` vinculado ao `tenantId`.

## Milestone 5 — Motor de Conversa + WhatsApp + Sandbox — 2026-07-18

- **Módulo `whatsapp/`**: interface `WhatsAppProvider` + `EvolutionProvider` (createInstance/getQrCode/sendMessage/parseWebhook para Evolution API v2) + factory `getWhatsAppProvider()`. Degrada sem config.
- **`agent-engine` motor**: `LLMProvider`/`OpenAIProvider` (function calling, `gpt-4o-mini`, degrada sem key), `tools` (schemas + handlers das 5 ações gravando no banco), `conversation` (get/create lead+conversa, histórico), `orchestrator.runAgentTurn` (persona + RAG via `searchSimilarChunks` + histórico → loop de tools máx 3 → resposta).
- **Webhook** `POST /api/webhooks/whatsapp`: mapeia instância→tenant, roda o turno e responde pelo provider. **Sandbox** `POST /api/sandbox`: mesmo motor sem WhatsApp real.
- **`/whatsapp`**: status + botão conectar/QR (server actions) + snippet de site. **`/conversas`**: chat de sandbox + lista de conversas com filtro (novo/morno/quente/precisa-humano) + histórico da conversa selecionada.
- Docs: README de `whatsapp`, README de `agent-engine` atualizado.
- **Critério atendido:** uma mensagem (sandbox ou WhatsApp) passa pelo motor, executa ação e persiste; conversa aparece no histórico. Verificado: build verde (18 rotas); gating `/api/sandbox`→307, webhook junk→200 `{ignored}`, `/whatsapp`→307; unit test do `parseWebhook` (extrai/ignora corretamente). _(Resposta de IA real requer `OPENAI_API_KEY`; envio real requer Evolution API + Postgres.)_

### Próximos passos → Milestone 6 (Follow-up + Relatórios)

- Worker BullMQ (`workers/follow-up-worker/`) lê conversas com `lastInboundAt` sem resposta e sem `followUpSentAt` → dispara follow-up e marca `followUpSentAt`.
- `/relatorios`: nº de conversas, leads capturados, leads quentes, taxa de resposta (do tenant).

## Milestone 4 — Checklist de Onboarding + Configuração do Agente — 2026-07-18

- **Checklist de onboarding** em `/inicio`: 6 passos com status calculado do banco (`src/modules/tenants/onboarding.ts`), barra de progresso e botão "Fazer" por item pendente.
- **`/configuracao`** (3 seções em cards): wizard de Persona → `composeSystemPrompt` salva `AgentConfig` (+ `personaDraft` para reeditar); Base de conhecimento (colar texto ou upload `.txt/.md/.pdf`) com lista e remoção; Ações com toggles e enforcement de `maxActiveActions` por plano.
- **Módulo `knowledge-base/`**: `extract` (pdf-parse v2 via `PDFParse.getText`), `chunk` (~800 chars c/ overlap), `embeddings` (OpenAI `text-embedding-3-small`, degrada sem key), `repository` (ingest/list/delete + `searchSimilarChunks` para o M5). Coluna `embedding vector(1536)` (Unsupported) gravada/consultada via SQL cru.
- **Módulo `agent-engine/`** (início): `ACTION_CATALOG` (5 ações, algumas `stub`) e `persona` (campos do wizard + gerador de prompt).
- Schema: `KnowledgeChunk` (pgvector), `KnowledgeDocument.status`, `AgentConfig.personaDraft`. Placeholders para `/whatsapp`, `/conversas`, `/relatorios`, `/feedback` (navegação sem 404).
- Docs: READMEs de `knowledge-base` e `agent-engine`.
- **Critério atendido:** cliente vê o checklist e conclui cada item sem sair do dashboard; itens mudam de status conforme avança. Verificado: build verde (16 rotas) + testes unitários de `chunkText`/`composeSystemPrompt`. _(Persistência real de persona/docs/ações e embeddings requerem Postgres+pgvector e `OPENAI_API_KEY`.)_

### Próximos passos → Milestone 5 (Motor de Conversa + WhatsApp)

- Interface `WhatsAppProvider` + adapter Evolution API (createInstance/getQrCode/sendMessage/onMessageReceived); tela `/whatsapp` com QR.
- `LLMProvider` (OpenAI function calling); orquestrador: persona + `searchSimilarChunks` (RAG) + histórico → tools ativas → executa ação → responde.
- Webhook `/api/webhooks/whatsapp`; sandbox de chat de teste; tela `/conversas` com histórico e filtros.

## Milestone 3 — Cadastro/Login + Seleção de Plano — 2026-07-17

- Módulo `billing/`: `stripe.ts` (cliente lazy), `checkout.ts` (Checkout Session com `price_data` inline — ADR-002), `service.ts` (`setTenantPlan` idempotente + `isValidPlan`).
- Tela `/planos` (pós-cadastro): grid de planos com `PlanPicker` (client). FREE → `POST /api/plan/free` → `/inicio`. Pago → `POST /api/checkout` → redireciona ao Stripe Checkout.
- Webhook `POST /api/webhooks/stripe`: valida assinatura (corpo cru), `checkout.session.completed` e `customer.subscription.*` atualizam `Tenant.planKey` via metadata `{tenantId, planKey}`; cancelamento → FREE.
- Cadastro agora redireciona para `/planos`; `/inicio` mostra plano atual e banner de sucesso (`?checkout=success`). Degradação graciosa quando Stripe não configurado (aviso + free funciona).
- Docs: billing/README, ADR-002.
- **Critério atendido:** do cadastro ao dashboard sem etapa manual. FREE funciona sem Stripe; fluxo pago usa Stripe modo teste. Verificado auth-gating: `/planos`→307 `/login`, `/api/checkout`→401, webhook sem secret→503. _(Fluxo end-to-end com pagamento real requer chaves Stripe + Postgres rodando.)_

### Próximos passos → Milestone 4 (Checklist + Configuração do Agente)

- `/inicio`: checklist de onboarding com status por item (persona, base, ações, WhatsApp, snippet, teste).
- `/configuracao`: wizard de persona (gera systemPrompt) + objetivo; upload de documento → embeddings (pgvector) no módulo `knowledge-base/`; toggles das ações (`TenantAction`).
- Enforcement de `maxActiveActions` por plano (usar `PLAN_BY_KEY`).

## Milestone 2 — Landing Page — 2026-07-17

- Grupo `src/app/(marketing)/` com layout próprio (Navbar sticky + Footer).
- Hero animado em loop com Framer Motion mostrando os 3 passos (cadastro → integra no site → integra no WhatsApp) + barra de progresso; 100% código, sem vídeo.
- Seções componentizadas (uma por arquivo em `_components/`): `Hero`, `ComoFunciona`, `Beneficios`, `AcoesExemplos`, `ProvaSocial`, `Planos`, `FAQ` (accordion animado), `CTAFinal`.
- Planos vêm de fonte única `src/modules/billing/plans.ts` (reuso na seleção de plano + Stripe no M3).
- Todo CTA aponta para `/cadastro` (verificado: 8 links na home). Placeholder antigo de `page.tsx` removido; `/` agora é a landing (estática).
- **Critério atendido:** landing carrega (HTTP 200), hero anima, todos os CTAs levam a `/cadastro`.

### Próximos passos → Milestone 3 (Cadastro/Login + Seleção de Plano)

- Tela `/planos` pós-cadastro: escolher FREE (libera dashboard direto) ou pago (Stripe Checkout modo teste → webhook provisiona/atualiza plano).
- Módulo `billing/`: cliente Stripe, criação de Checkout Session, `POST /api/webhooks/stripe` (idempotente) atualizando `Tenant.planKey`.
- Ajustar redirect do cadastro para `/planos` (hoje vai direto a `/inicio`).
- Magic Link por e-mail (opcional no MVP — avaliar provider de e-mail).

## Milestone 1 — Fundação — 2026-07-17

- Next.js 16 + TypeScript + Tailwind v4 + UI shadcn-style (Button, Input).
- Prisma 6 + PostgreSQL (pgvector) — schema inicial completo (Tenant, User, AgentConfig, KnowledgeDocument, TenantAction, WhatsappInstance, Lead, Conversation, Message, Feedback).
- Auth.js v5 (Credentials, sessão JWT) com `role`/`tenantId` no token; guards em `src/lib/session.ts`.
- Cadastro (`/cadastro`) → provisiona tenant + owner (`src/modules/tenants/provision.ts`); login (`/login`); dashboard protegido com sidebar e `/inicio` vazio.
- `docker-compose.yml` (Postgres+pgvector, Redis), `.env.example`, seed (superadmin + tenant demo).
- Docs: INDEX, ARCHITECTURE, CONVENTIONS, ADR-001 (pin Prisma 6).
- **Critério atendido:** usuário cadastra, loga e cai em dashboard vazio.

### Próximos passos → Milestone 2 (Landing Page)

- `src/app/(marketing)/` com hero animado (Framer Motion) mostrando 3 passos: cadastro → integra no site → integra no WhatsApp.
- Seções componentizadas: `Hero`, `ComoFunciona`, `Beneficios`, `Planos`, `FAQ`, `CTA`. Todo CTA → `/cadastro`.
- Substituir o placeholder atual em `src/app/page.tsx`.
