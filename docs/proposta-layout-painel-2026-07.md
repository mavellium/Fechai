# Proposta de layout — `/inicio`, `/conversas`, `/whatsapp`

Continuação de `revisao-ui-painel-2026-07.md`. Aquele passe consertou
**consistência** (primitivos, estados, acessibilidade). Este é sobre **layout e
densidade**: as três telas hoje são uma coluna de cards empilhados, o que faz
qualquer uma delas parecer um rascunho — independente da qualidade dos
componentes dentro.

Nada aqui pede dependência nova. Tudo sai dos primitivos que já existem
(`Card`, `Stat`, `Badge`, `FilterTabs`, `SegmentedControl`, `EmptyState`,
`ChatLog`, `ConfirmButton`, `<dialog>` nativo).

---

## 0. Problema comum às três

| Sintoma | Causa |
|---|---|
| As telas "pulam" de largura ao navegar | `/inicio` é `max-w-3xl`, `/conversas` `max-w-5xl`, `/whatsapp` `max-w-3xl`, `/relatorios` `max-w-4xl` |
| Tudo parece ter o mesmo peso | Só existe um nível de superfície: `Card`. Não há hierarquia entre "o assunto da tela" e "o resto" |
| Desktop desperdiçado | Nenhuma tela usa mais de uma coluna de verdade (`/conversas` usa duas, mas rola a página inteira) |
| A tela não muda quando o estado muda | `/inicio` mostra o mesmo checklist para quem acabou de entrar e para quem já opera há 3 meses; `/whatsapp` mostra a mesma coisa conectado e desconectado |

**Regra base para as três:** container único `mx-auto max-w-6xl`, grade de 12
colunas, e a tela **muda de forma conforme o estado da conta** — não só de texto.

---

## 1. `/inicio` — de checklist para home operacional

### Hoje
Um `Card` com a barra de progresso e os 6 passos. Quando o onboarding termina,
a tela vira um checklist todo riscado: **não sobra motivo para abrir `/inicio`**.
E a pergunta real de quem loga ("como meu agente foi desde ontem?") não é
respondida em lugar nenhum — `/relatorios` só dá números desde o início da conta.

### Proposta: duas fases da mesma rota

#### Fase A — setup incompleto (`doneCount < steps.length`)

O erro hoje é tratar os 6 passos como iguais. São uma sequência: só o **próximo**
importa.

```
┌─ PageHeader ───────────────────────────────── [Testar agente] ┐
│ início · Olá, {tenant}                                        │
│ Faltam 3 passos para seu agente atender sozinho.              │
├───────────────────────────────────────────────────────────────┤
│ ██████████░░░░░░░░  3 de 6                                    │
│                                                               │
│ ┌── PRÓXIMO PASSO ─────────────────────────────────────────┐  │
│ │  04  Conectar seu número de WhatsApp                     │  │
│ │      Aponte a câmera do celular para o código e pronto.  │  │
│ │                                    [ Conectar agora → ]  │  │  ← única ação primária
│ └──────────────────────────────────────────────────────────┘  │
│                                                               │
│ Concluídos (3)                                     ▾ expandir │  ← <details>, colapsado
│ Depois disso · 2 passos                                       │  ← lista compacta, sem botão
└───────────────────────────────────────────────────────────────┘
```

- O passo atual vira um card destacado (borda `iris/30` em vez de `white/10`),
  ocupando largura total. Os concluídos colapsam num `<details>` — o valor deles
  é "já fiz", não "leia de novo".
- Uma ação primária por tela, como manda a skill (§9). Hoje há até 6 botões
  "Começar" idênticos competindo.

#### Fase B — operando (`allDone`)

A rota deixa de ser checklist e vira resumo. **Este é o ganho maior da proposta.**

```
┌─ PageHeader ────────────────────────── [Testar agente] [Ver conversas] ┐
│ início · Boa tarde, {tenant}                                           │
├────────────────────────────────────────────────────────────────────────┤
│ ● Agente ativo   ● WhatsApp conectado   ● plano PRO · 128/500 mensagens│  ← faixa de saúde
├──────────────────────────────────────────┬─────────────────────────────┤
│ ┌ 7 dias ┬ 30 dias ┬ tudo ┐              │  PRECISA DE VOCÊ        (2) │
│                                          │  ─────────────────────────  │
│  Conversas   Leads novos  Quentes  Você  │  Maria S.  · há 12min    →  │
│     34 ↑8       12 ↑3        5      2    │  "quero falar com uma..."   │
│                                          │  (11) 9xxxx-xxxx · há 2h →  │
│  ▁▂▅▃▇▆▄  conversas por dia              │                             │
│                                          │  ─────────────────────────  │
│ ÚLTIMAS CONVERSAS                        │  ATALHOS                    │
│ ─────────────────────────────            │  Ajustar o jeito de falar → │
│ João P.   quente   "e o preço do..."  →  │  Enviar novo documento    → │
│ Ana M.    novo     "vocês atendem..."  → │  Ver relatório completo   → │
│ ...5 itens                               │                             │
│                              Ver todas → │                             │
└──────────────────────────────────────────┴─────────────────────────────┘
       lg:col-span-8                              lg:col-span-4
```

Decisões:

- **Faixa de saúde no topo**: responde "está tudo no ar?" antes de qualquer
  número. Reaproveita `StatusDot`. Se algo estiver quebrado (WhatsApp caiu,
  nenhum agente ativo), a faixa vira `Alert tone="warn"` com o link do conserto —
  é o lugar natural para avisar, e hoje não existe nenhum.
- **`SegmentedControl` de período** (7 / 30 / tudo). O componente já existe. Sem
  isso, os números do topo repetem `/relatorios` e a tela não tem razão de ser.
- **"Precisa de você" é o item de maior valor do produto inteiro** e hoje está
  enterrado atrás de um filtro em `/conversas`. Na home, com o trecho da última
  mensagem, vira a primeira coisa que a pessoa vê ao logar.
- **Sparkline** dos últimos 7 dias: 7 divs com `height` proporcional, `aria-label`
  com os valores em texto. Sem biblioteca de gráfico.
- Delta (`↑8`) precisa do período anterior — dá para calcular na mesma query.
- Vazio: conta pronta mas sem nenhuma conversa → um card só, "Seu agente está no
  ar esperando o primeiro cliente", com o CTA do sandbox.

---

## 2. `/conversas` — de "duas colunas que rolam juntas" para caixa de entrada

### Hoje
`grid lg:grid-cols-[320px_1fr]` dentro do scroll da página, e o sandbox
empilhado embaixo. Três problemas concretos:

1. A página inteira rola. Numa conversa longa, a lista de conversas some da tela
   e o cabeçalho ("com quem eu estou falando") também.
2. O sandbox ocupa espaço permanente numa tela cujo assunto são conversas reais.
3. `take: 50` corta sem avisar, sem busca e sem "carregar mais" (pendência 5 do
   doc anterior).
4. Ao abrir uma conversa não há nenhum contexto do lead além do telefone — nem
   status, nem quando começou, nem qual agente atendeu, nem o que fazer a seguir
   (pendência 4: o handoff termina num beco).

### Proposta: três painéis, cada um com scroll próprio, altura da viewport

```
┌─ PageHeader ───────────────────── [Testar agente] ← abre <dialog> com o Sandbox ┐
├────────────────┬───────────────────────────────────┬──────────────────────────┤
│ 🔍 buscar      │ Maria Silva          precisa de   │  STATUS                  │
│ [todos|quentes │ (11) 98xxx-xxxx        você       │  ┌ novo │ quente │ ... ┐  │ ← SegmentedControl
│  |precisam|... ]│ ─────────────────── sticky ───── │                          │
│ ─────────────  │                                   │  Primeiro contato        │
│ ▸ PRECISAM (2) │   ┌───────────────────┐           │  12 jul, 14:32           │
│  Maria S.  12m │   │ oi, vocês fazem.. │           │  Última mensagem         │
│  (11)9xx.. 2h  │   └───────────────────┘           │  há 12 minutos           │
│ ─────────────  │        ┌────────────────────────┐ │  Atendido por            │
│ ▸ RECENTES     │        │ Fazemos sim! Posso te..│ │  Agente Vendas           │
│  João P.   1d  │        └────────────────────────┘ │  Follow-up               │
│  Ana M.    2d  │                                   │  enviado há 1 dia        │
│  ...           │ ───────────────────────────────── │  ──────────────────────  │
│                │ [ responder pelo painel...    ⏎ ] │  [Marcar como resolvida] │
│ carregar mais  │  ou: [Abrir no WhatsApp ↗]        │  [Abrir no WhatsApp ↗]   │
└────────────────┴───────────────────────────────────┴──────────────────────────┘
  w-[320px]            flex-1                            w-[300px] (xl: só)
```

Decisões:

- **`h-[calc(100vh-...)]` + `overflow-y-auto` por coluna.** É o padrão de toda
  caixa de entrada (Gmail, Intercom, WhatsApp Web) porque funciona: a lista e o
  cabeçalho do thread nunca sumem. O `PanelShell` já fixa a casca em `h-screen`
  com só o `main` rolando — essa tela é a que mais se beneficia disso.
- **Sandbox sai da página** e vira botão no `PageHeader` abrindo um `<dialog>`
  (mesma técnica do `ConfirmButton`/`MobileNav`). A tela passa a ser sobre
  conversas de verdade; o teste continua a um clique. O `EmptyState` da lista
  continua apontando para ele.
- **Agrupamento na lista** em vez de só ordenação: "Precisam de você" no topo,
  depois "Hoje", "Esta semana", "Antes". Faz o filtro `needs_human` virar
  atalho, não a única forma de achar o que importa.
- **Busca por nome/telefone** + botão "carregar mais" (server action com cursor).
  Resolve o corte silencioso em 50.
- **Terceira coluna = contexto + ações.** É o que fecha a pendência 4: hoje o
  agente marca "precisa de humano" e não há nada a fazer na tela. Mesmo sem
  implementar o envio de mensagem no primeiro passo, "Marcar como resolvida"
  (limpa `needsHuman`) + "Abrir no WhatsApp" (`https://wa.me/{phone}`) já tiram a
  tela do beco sem saída.
- **Mobile**: um painel por vez. Sem `id` na URL → lista; com `id` → thread com
  seta de voltar; o contexto do lead vira um `<details>` no topo do thread.
  A URL já carrega o estado (`?status=&id=`), então isso é só CSS + um link.
- **Bolhas**: hoje cada mensagem é uma bolha solta. Agrupar mensagens seguidas do
  mesmo autor (só a última recebe o "rabinho") e inserir separador de data
  reduz muito o ruído visual num histórico longo.

---

## 3. `/whatsapp` — de dois cards para uma tela orientada a estado

### Hoje
Card "Status da conexão" + card "Colocar o agente no seu site", empilhados, iguais.
O QR só aparece depois de clicar em "Gerar código de conexão" — um clique a mais
para a única coisa que a pessoa veio fazer. E o card do site é um assunto
diferente (outro canal) com o mesmo peso visual do canal principal.

### Proposta: a tela tem uma missão e ela muda com o estado

#### Estado A — desconectado / pending_qr

```
┌─ PageHeader ──────────────────────────────────────────────────┐
│ whatsapp · Conectar seu WhatsApp                              │
├───────────────────────────────┬───────────────────────────────┤
│                               │  1  Abra o WhatsApp no celular│
│      ███ ▄▄ █ ▀█ ███          │                               │
│      █ █ ██▀▄ ▀▄ █ █          │  2  Toque em Aparelhos        │
│      ███ ▀▄█▀▄█▀ ███          │     conectados                │
│         QR grande             │                               │
│                               │  3  Toque em Conectar aparelho│
│  expira em 1:47 · [gerar novo]│     e aponte para o código    │
│                               │                               │
│  ● Aguardando leitura...      │  Não tem a câmera aí?         │
│                               │  [Enviar link para meu email] │
└───────────────────────────────┴───────────────────────────────┘
```

- **QR gerado automaticamente** ao abrir a tela quando o status é `disconnected`.
  O botão vira "gerar novo código" (secundário). O polling já existe.
- **Cronômetro de expiração**: hoje o QR morre em silêncio e o `POLL_MAX_TRIES`
  encerra o polling sem dizer nada — a tela fica mentindo "aguardando" para
  sempre, que é exatamente o bug nº 13 voltando por outro caminho.
- QR grande (≥ 240px) e centralizado na coluna: é o objeto principal da tela.

#### Estado B — conectado

Nada do que está acima é útil. A tela vira painel de saúde do canal:

```
┌────────────────────────────────────────────────────────────────┐
│  ● Conectado · (11) 98xxx-xxxx · desde 12 jul                  │
│  34 mensagens recebidas nos últimos 7 dias · última há 12min   │
│                                                                │
│  [ Fazer um teste de verdade ]  ← manda mensagem para o número │
│  [ Desconectar ]  ← ConfirmButton, secundário                  │
└────────────────────────────────────────────────────────────────┘
```

#### Os dois estados: canais como lista

Em vez de dois cards irmãos, uma seção "Onde seu agente atende":

```
CANAIS
┌──────────────────────────────────────────────────┐
│ 💬 WhatsApp        ● conectado         gerenciar │  ← card principal (acima)
│ 🌐 Site            ○ não instalado    instalar → │  ← abre o SnippetBox
│ 📷 Instagram       em breve                      │  ← desabilitado, sinaliza roadmap
└──────────────────────────────────────────────────┘
```

O `SnippetBox` sai do fluxo principal e vira o conteúdo do canal "Site"
(`<details>` ou rota `/whatsapp?canal=site`). Assim a tela tem um assunto por
vez e ganha lugar para crescer sem virar pilha de cards.

> Se preferir, esta seção pede uma rota própria `/canais` com `/whatsapp`
> redirecionando — mas dá para fazer tudo dentro de `/whatsapp` primeiro e
> renomear depois.

---

## 4. O que exige mudança fora do layout

Levantei o que **não** dá para fazer só mexendo em JSX, para não virar surpresa
no meio da implementação:

| Item da proposta | O que falta hoje |
|---|---|
| Números por período (7/30 dias) e delta | `computeTenantReport` é só "desde o início". Precisa aceitar `{ since }` e devolver o período anterior |
| Sparkline de conversas/dia | `groupBy` por dia — `Message.createdAt` já serve |
| "Não lido" na lista de conversas | Não existe campo. Precisa de `lastReadAt` em `Conversation` (migration) |
| Número conectado / "desde" em `/whatsapp` | `WhatsappInstance` só guarda `status`, `externalId`, `updatedAt`. Precisa de `phone` e `connectedAt`, ou buscar do provedor |
| Expiração do QR | O provedor não devolve validade; dá para assumir ~60s a partir da geração e regenerar |
| Uso do plano na faixa de saúde | Verificar se já existe contador de mensagens por ciclo; se não, é outra história |
| Responder pelo painel | Envio outbound pela Evolution API — é feature, não layout. As ações "resolver" + "abrir no WhatsApp" já destravam a tela sem isso |
| Busca e "carregar mais" em `/conversas` | Server action com cursor; `Lead.name`/`phone` já dão a busca |

---

## 5. Ordem sugerida

1. **`/conversas`** — maior ganho por esforço. Três painéis com scroll próprio,
   sandbox em dialog, agrupamento da lista, coluna de contexto com "resolver" e
   "abrir no WhatsApp". Não precisa de migration.
2. **`/whatsapp`** — QR automático, cronômetro, estado conectado próprio, canais
   em lista. Só o "número/desde" precisa de campo novo; sem ele, o estado
   conectado ainda funciona.
3. **`/inicio` fase B** — depende do relatório por período. É o que transforma a
   home de tela de setup em tela de uso diário.

Antes de qualquer uma: unificar `max-w-6xl` nas telas do painel, para o conteúdo
parar de mudar de largura a cada navegação.
