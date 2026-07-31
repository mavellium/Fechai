# Revisão de UI do painel — 2026-07-28

Passe completo de diagnóstico, correção e padronização nas telas logadas: grupo
`(dashboard)` (6 telas) e grupo `(admin)` (3 telas), mais os primitivos
compartilhados que elas usam.

- Escopo: `src/app/(dashboard)/`, `src/app/(admin)/`, `src/components/`.
- Fora do escopo: landing `(marketing)`, `/planos`, `/cadastro`, `/login`. Só
  foram tocados onde compartilhavam um componente duplicado com o painel.

---

## 1. Diagnóstico — o que estava quebrado

### 1.1 Bugs funcionais

| # | Onde | O que estava errado | Consequência |
|---|---|---|---|
| 1 | `agentes/KnowledgeManager.tsx` | `if (state?.ok) formRef.current?.reset()` **no corpo do render** | Efeito colateral em render: enquanto `state.ok` fosse verdadeiro, todo re-render limpava o formulário — apagava o que a pessoa digitava para o documento seguinte |
| 2 | `agentes/KnowledgeManager.tsx` | retorno de `removeDocument` descartado com `void` | Falha ao remover sumia em silêncio; o documento continuava na lista sem explicação |
| 3 | `(dashboard)/layout.tsx`, `(admin)/layout.tsx` | `<aside className="hidden … md:flex">` sem nenhum substituto abaixo de 768px | **Sem navegação no celular**: quem abrisse o painel no telefone ficava preso na primeira tela |
| 4 | `conversas/page.tsx` vs `conversas/Sandbox.tsx` | bolhas de chat invertidas entre as duas telas (no histórico o lead saía branco à esquerda e o agente iris à direita; no sandbox, o contrário) | Quem testava no sandbox e abria o histórico via os papéis trocados |
| 5 | `Sandbox.tsx`, `conversas/page.tsx` | container de mensagens sem rolagem automática | Mensagem nova entrava abaixo da área visível; a resposta do agente não aparecia sem rolar à mão |
| 6 | `admin/contas/TenantRow.tsx`, `admin/feedbacks/FeedbackStatus.tsx` | `<select onChange={gravaNoBanco}>` | Commit implícito: navegando um select **fechado** pelo teclado, o navegador dispara `change` a cada opção percorrida — gravava planos/status intermediários no banco |
| 7 | `TenantRow.tsx`, `KnowledgeManager.tsx` | suspender conta e remover documento executavam no primeiro clique | Ação destrutiva sem confirmação |
| 8 | `inicio/page.tsx` | `Math.round((doneCount / steps.length) * 100)` sem guarda | Catálogo de passos vazio → `NaN%` na barra de progresso |
| 9 | `agentes/ActionsToggles.tsx` | um `pending` global | Os 5 toggles desabilitavam juntos e nada indicava qual estava salvando |
| 10 | `agentes/ActionsToggles.tsx` | limite do plano só era verificado no servidor | A pessoa clicava e só então recebia "seu plano permite N ações" |
| 11 | `admin/contas/NewAccountForm.tsx` | `setState` dentro de `useEffect` | Erro de lint `react-hooks/set-state-in-effect` + renderização em cascata |
| 12 | `admin/ia/ModelPicker.tsx` | `role="radiogroup"` num `<ul>` com `<li>` entre o grupo e os `role="radio"` | Árvore de acessibilidade quebrada: o leitor de tela não anunciava o grupo |
| 13 | `whatsapp/WhatsappConnect.tsx` | status só mudava com clique manual em "Atualizar status" | Quem escaneava o QR e não voltava para clicar via "aguardando" para sempre |

### 1.1.1 Correções da segunda passada

Encontradas na revisão do próprio passe:

| # | Onde | O que estava errado | Consequência |
|---|---|---|---|
| 15 | `ui/select.tsx` | a seta era um `<svg>` irmão dentro de um wrapper `relative`, e o wrapper **não recebia o `className`** — a largura passada por quem chama ia para o `<select>`, mas o wrapper continuava com 100% | Em todo select mais estreito que o container (ex.: `w-32` na tabela de contas) a seta descolava do campo e flutuava à direita |
| 16 | tema | raio e tipografia micro como valor solto: `rounded-md`/`lg`/`xl`/`2xl` misturados na mesma tela e `text-[9px]`/`[10px]`/`[11px]` para o mesmo papel | Contraria a regra "um raio por papel, tamanhos só da escala" da skill — e não havia onde consertar de uma vez, porque não era token |

Fora do painel, mas travava o `npm run lint` do repositório inteiro:

| # | Onde | O que estava errado |
|---|---|---|
| 14 | `planos/PlanPicker.tsx` | `window.location.href = data.url` viola `react-hooks/immutability` |

### 1.2 Acessibilidade

- **Labels não associadas ou inexistentes**: `PersonaForm` usava `<label>` sem
  `htmlFor` e inputs sem `id`; `KnowledgeManager` e a busca de `/admin/contas`
  só tinham `placeholder` como rótulo.
- **Busca do admin sem botão de submit** — só funcionava para quem adivinhasse
  que era Enter.
- **`focus-visible` ausente** em ~10 controles feitos à mão: link "Fazer" do
  checklist, pílulas de filtro, lixeira de documento, X de fechar, botão de
  copiar, toggle de ação, links da navegação lateral.
- **Toggle com semântica errada**: `aria-pressed` (botão pressionado) em vez de
  `role="switch"` + `aria-checked` (estado persistente).
- **Nota por estrelas**: 5 `<button>` soltos, sem grupo — teclado passava por 5
  paradas sem saber que era um valor só, e o rótulo dizia "1 estrelas".
- **Erros e sucessos em `<p>` solto**: não eram anunciados por leitor de tela e
  transmitiam o estado só pela cor.
- **Contraste abaixo de AA**: `text-white/35` e `text-white/40` sobre `ink`
  (`#14171F`) dão ≈3.4–3.9:1, abaixo dos 4.5:1 exigidos para texto normal — e
  eram usados justamente na tipografia pequena (10–11px) de metadados.
- **Estado só por cor**: risco no texto do passo concluído, ícone ✓/✕ do
  checklist, bolinha de status do WhatsApp.
- **Sem skip link** para pular a navegação.
- **Tabela do admin** sem `scope="col"`, sem `<caption>` e com região de
  rolagem horizontal inalcançável pelo teclado.
- **Status crus em inglês** na interface (`warm`, `hot`, `pending_qr`,
  `disconnected`) ao lado de filtros já traduzidos.

### 1.3 Estados obrigatórios faltando

A skill de design exige carregando / vazio / erro / preenchido em toda tela com
dados. O painel tinha só o último:

- **Nenhum `loading.tsx`** em nenhuma das 9 rotas, embora todas sejam Server
  Components com consulta ao Prisma — a navegação ficava parada na tela
  anterior, sem sinal de vida.
- **Nenhum `error.tsx` no admin**; o do dashboard não registrava o erro nem
  mostrava o `digest`.
- **Vazios sem próximo passo**: "Nenhum feedback.", "Nenhum tenant
  encontrado.", "Selecione uma conversa…" — beco sem saída.
- `/relatorios` sem estado vazio: conta nova via uma grade de sete zeros, que
  parece relatório quebrado.

### 1.4 Componentes duplicados / divergentes

| Elemento | Implementações antes | Depois |
|---|---|---|
| Campo com label | 3 (`LabeledField` em `(auth)`, `Field` no onboarding, `<label>` solto no painel) | 1 (`ui/field.tsx`) |
| `<select>` estilizado | 3 (contas, feedbacks, NewAccountForm) — tamanhos e focos diferentes | 1 (`ui/select.tsx`) |
| Copiar para área de transferência | 2 (senha provisória, snippet), nenhuma tratando erro de permissão | 1 (`ui/copy-button.tsx`) |
| Layout de painel | 2 quase idênticos (~50 linhas cada), já divergindo | 1 (`shell/PanelShell.tsx`) |
| Pílula de status | ~8 cópias de `rounded-full px-2 py-0.5 font-mono text-[9px]`, com tamanhos de fonte diferentes | 1 (`ui/badge.tsx`) |
| Cabeçalho de página | 7 cópias com espaçamentos ligeiramente diferentes | 1 (`ui/page-header.tsx`) |
| Grupo de filtros | 2 (conversas, feedbacks) | 1 (`ui/filter-tabs.tsx`) |
| Bolha de chat | 3 (sandbox, histórico, prévia do onboarding) — **2 discordavam** | 1 (`chat/ChatBubble.tsx`) |
| Botão em fundo escuro | override manual `className="border-white/20 bg-transparent text-white/70 hover:bg-white/10"` repetido em 4 lugares | variante `panel:` embutida |

Também havia código morto: `(dashboard)/_components/Placeholder.tsx`, sem nenhum
importador.

---

## 2. Padronização — qual biblioteca e por quê

### Decisão: **manter shadcn/ui** (primitivos locais em `src/components/ui/`), expandindo o conjunto. Zero dependências novas.

O projeto **já era** shadcn/ui, só que com um conjunto incompleto: `cn()` com
`clsx` + `tailwind-merge`, variantes com `class-variance-authority`, tokens no
`@theme` do Tailwind v4, ícones `lucide-react`. Existiam 4 primitivos (button,
input, textarea, card) para uma superfície que precisava de ~18 — e a diferença
era preenchida com HTML solto em cada tela. O problema nunca foi a biblioteca:
foi o catálogo pela metade.

Por que **não** trocar:

- **MUI / Ant Design** trazem sistema de tema próprio (emotion / less). Ficariam
  duas fontes de verdade para cor e espaçamento, e os tokens de marca do
  `globals.css` deixariam de ser a fonte única — que é justamente a regra nº 1
  do design system deste produto. Também empurram uma linguagem visual
  (Material / Ant) que briga com a identidade editorial escura do painel.
- **Radix UI** seria a evolução natural (primitivos headless, sem opinião
  visual). Mas o que de fato faltava dele — foco preso, `Esc`, `inert` no resto
  da página e devolução de foco ao gatilho — o elemento `<dialog>` nativo já
  entrega. Não valia uma dependência a mais para isso. **Se um dia entrar
  combobox com busca, tooltip ou menu, aí Radix passa a valer** (ver pendências).

### Catálogo depois do passe

`src/components/ui/`
`alert` (+`FormFeedback`) · `badge` (+`StatusDot`) · `button` (+`ButtonLink`) ·
`card` · `confirm-dialog` · `copy-button` · `empty-state` · `field`
(+`fieldProps`, `Fieldset`) · `filter-tabs` · `input` (+`fieldBase`) ·
`loading-dots` · `page-header` · `segmented-control` · `select` · `skeleton`
(+`PageSkeleton`) · `stat` · `switch` · `textarea` · `TypingToCheck`

`src/components/shell/` — `PanelShell` · `ShellNav` · `MobileNav` · `PanelError`
`src/components/chat/` — `ChatBubble` · `ChatLog`

---

## 3. Decisões de design e o motivo

### 3.1 Superfície por atributo: `data-surface="dark"` + variante `panel:`

O produto tem duas superfícies: `paper` (marketing, auth, onboarding) e `ink`
(painel logado). Antes, cada tela do painel reescrevia à mão o mesmo override
de cor em cada botão e campo — daí as três divergências da tabela acima.

Agora `PanelShell` marca `data-surface="dark"` **uma vez**, e o `globals.css`
declara:

```css
@custom-variant panel (&:where([data-surface="dark"] *));
```

Os primitivos trazem a variante embutida (`panel:border-white/20`,
`panel:bg-white/5`, …). **Nenhuma tela precisa saber em que fundo está.**
Verificado no CSS compilado: 46 regras `[data-surface=dark]`, incluindo
variantes compostas (`panel:enabled:hover:*`, `panel:[&>option]:bg-ink`).

### 3.1.1 Raio e tipografia micro viraram token

A skill manda escolher um raio e usar em tudo, e manter os tamanhos na escala.
O produto tinha 4 raios misturados e 3 tamanhos para o mesmo papel — e como eram
valores soltos em cada arquivo, não havia um lugar para corrigir.

Agora saem do `@theme` (`--radius-control` 8px, `--radius-surface` 12px,
`--text-micro` 11px), com `rounded-full` livre para pílulas. A regra passa a ser
verificável: qualquer `rounded-[Npx]` ou `text-[Npx]` no código é desvio.

**A seta do `<select>` também mudou de técnica por causa disso**: virou
`background-image` na classe `.ui-select`, sem wrapper. Assim o `<select>` é um
elemento só e `className` (largura, margem) se comporta como em qualquer campo.

### 3.2 `signal` é acento de marca no painel; ação é `iris`

A regra da skill diz que `signal` é exclusivo de CTA e que dois elementos não
podem disputá-lo na mesma tela. No painel, `signal` já aparecia no sobrenome da
rota, na barra de progresso e no ponto do wordmark. Em vez de recolorir tudo,
fixei a divisão:

- **Painel**: ação primária = `iris`; `signal` só como acento de marca.
- **Telas de conversão** (landing, cadastro, planos, onboarding): CTA em
  `signal`, uma por tela.

Assim nada disputa `signal` dentro de uma mesma tela. (Ver pendência 3.)

### 3.3 `<dialog>` nativo em vez de biblioteca de modal

Usado no `ConfirmButton` e no `MobileNav`. `showModal()` entrega foco preso,
`Esc`, backdrop e devolução de foco ao gatilho — de graça, sem armadilha de foco
escrita à mão e sem dependência.

### 3.4 `<select>` nativo, não dropdown custom

Entrega teclado, busca por digitação e o seletor do sistema no mobile. Um
dropdown custom teria que reimplementar os três.

### 3.5 Commit explícito em vez de `onChange` que grava

Como o `change` de um select fechado dispara a cada seta do teclado, gravar no
`onChange` gravava estados intermediários. Duas soluções, conforme o caso:

- **Plano do tenant** (4 opções, consequência em cobrança): select + botões
  "Salvar"/"Desfazer" que só aparecem quando o valor muda, e confirmação.
- **Situação do feedback** (3 opções, triagem de alto volume): `SegmentedControl`
  — cada opção é um botão, então um clique = uma intenção = uma gravação.

### 3.6 Confirmação onde é destrutivo, não em tudo

`ConfirmButton` em suspender/reativar conta e remover documento. **Não** em
trocar de plano (já tem commit explícito com "Desfazer") nem em ligar/desligar
ação (reversível num clique). Confirmação em tudo vira ruído e as pessoas
aprendem a clicar "OK" sem ler.

### 3.7 `/conversas` reordenada

O sandbox ocupava o topo e empurrava a lista de conversas para baixo. A página
é sobre conversas: a lista subiu, o sandbox virou card secundário no fim. O
vazio da lista aponta para ele.

### 3.8 Cabeçalho de `/agentes` renomeado

Era "Configuração do agente", que colidia com a tela `/configuracoes` no menu —
duas telas se apresentando como "configuração". Virou "Seu agente", batendo com
o item de menu. **A rota não mudou.**

### 3.9 Textos corrigidos por precisão

O sandbox **cria** um lead/conversa com telefone `sandbox` (ver
`api/sandbox/route.ts`). A copy agora diz isso em vez de sugerir que o teste não
deixa rastro.

---

## 4. Estados implementados

- `loading.tsx` em `(dashboard)` e `(admin)` → `PageSkeleton`.
- `error.tsx` nos dois grupos → `PanelError` (registra o erro, mostra o `digest`
  para a pessoa citar no chamado, oferece "Tentar de novo" e "Enviar feedback").
- Estado vazio com próximo passo em: conversas (lista, detalhe e filtro sem
  resultado), documentos da base, relatórios, contas do admin, feedbacks.
- `loading` no `Button` (pontos da marca + `aria-busy`), no `Switch` e no
  `SegmentedControl` — o `LoadingDots` é a versão só-CSS da assinatura
  "digitando → check", sem hook, para poder rodar em Server Component.

---

## 5. Verificação

Feito:

- `npm run build` — verde, 24/24 páginas geradas.
- `npm run lint` — verde. **Estava vermelho antes deste passe**, com 2 erros
  pré-existentes (`NewAccountForm`, `PlanPicker`), os dois corrigidos.
- CSS de produção inspecionado para confirmar que a variante `panel:` compila,
  inclusive composta.

**Não feito — recomendo antes de publicar:** passe manual no navegador. Tentei
subir o dev server na porta 3005 para um smoke test e ele falhou; não insisti.
Os pontos que só o navegador confirma:

1. Gaveta de navegação no celular (~375px): abre, fecha no `Esc`, fecha ao
   navegar, devolve o foco.
2. Diálogo de confirmação: suspender conta e remover documento.
3. Polling do WhatsApp: QR na tela → escanear → status vira "Conectado" sozinho.
4. Rolagem automática do chat no sandbox e no histórico.
5. Tabela de contas em tela estreita.

---

## 6. Pendências e recomendações

1. **Passe manual no navegador** nos 5 pontos acima (375px e desktop).
2. **`/planos`, `/login`, `/cadastro` e a landing não foram padronizados** — só
  receberam o reflexo dos primitivos compartilhados. Têm a mesma dívida de
  estados e rótulos; vale um passe equivalente.
3. **Sobrenome da rota em `signal`** (o `início`, `conversas`, `admin` no topo
  de cada página) é, pela letra da skill, uso decorativo de uma cor reservada a
  CTA. Mantive por consistência com o que já está em produção na landing e no
  onboarding. **Decidir no brand guide** se muda — e, se mudar, mudar no produto
  inteiro de uma vez, não só no painel.
4. **`/conversas` é só leitura.** O agente marca "precisa humano", mas não há
  caixa para responder ao lead pelo painel — o handoff termina num beco.
5. **Sem paginação**: `/conversas` corta em 50 registros sem avisar e
  `/admin/contas` lista tudo.
6. **Sem teste automatizado de UI.** Sugestão: Playwright com smoke test nas 9
  rotas logadas + `@axe-core/playwright` para pegar regressão de acessibilidade
  (contraste e rótulo são exatamente o tipo de coisa que volta sozinha).
7. **Radix UI** passa a valer no dia em que entrar combobox com busca, tooltip
  ou menu suspenso — coisas que o HTML nativo não resolve bem. Até lá, não.
8. **`TypingToCheck` e `LoadingDots` coexistem**: o primeiro tem hook (typing ↔
  check animado), o segundo é só-CSS e server-safe. O cabeçalho de cada arquivo
  explica quando usar qual; se virar confusão, unificar.
