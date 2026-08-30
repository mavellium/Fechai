# Programa de afiliados

Comissão **recorrente** por indicação: o afiliado ganha um percentual de **cada
mensalidade paga** pela conta que indicou, enquanto a assinatura durar — não só
na primeira compra. É o modelo que faz sentido num SaaS, e é a promessa que a
landing pública vende.

## Mapa dos arquivos

| Arquivo | Papel |
| --- | --- |
| `config.ts` | Regras do programa: percentual padrão (bps), janela de estorno, mínimo de saque, validade e nome do cookie. **Fonte única** — nenhum número desses aparece chumbado em componente. |
| `code.ts` | Geração/normalização do código público do link (`?ref=`). Alfabeto sem caracteres ambíguos. |
| `service.ts` | Escrita: criar afiliado, atribuir indicação, registrar comissão, churn, maturação. |
| `stats.ts` | Leitura: saldo, funil, MRR e série mensal (`getAffiliateOverview`). |
| `labels.ts` | Tradução dos enums para o painel e para os relatórios (um lugar só). |
| `roles.ts` | Papéis da conta (`getAccountRoles`, `isAffiliateOnly`) — quem vê o quê no painel. |

## Conceitos que não são óbvios

**Afiliado é um PAPEL do usuário, não uma conta separada.** `Affiliate` é 1:1
com `User`. A mesma pessoa pode ser cliente, afiliada ou as duas — escolhido no
`/cadastro` (campo `roles`) e alterável a qualquer momento em `/configuracoes`.
A conta (tenant) nasce sempre; marcar "afiliado" só acrescenta o cadastro no
programa.

### Os dois papéis, e por que moram em lugares diferentes

| Papel | Onde é guardado | O que libera |
| --- | --- | --- |
| **Cliente** (usa o agente) | `User.usesProduct` (boolean) | Início, Agentes, Integrações, Contatos, Conversas, Agenda, `/planos`, onboarding, cota e trial |
| **Afiliado** | existe `Affiliate` com status ≠ `OPTED_OUT` | Aba `/afiliado` e a visão "Afiliados" em `/relatorios` |

Cliente é um booleano porque não há "linha de cliente" a criar — o tenant já
existe para toda conta, é o que dá login. Afiliado é uma linha porque carrega
código, percentual e dados de pagamento.

`getAccountRoles(userId)` em `roles.ts` é a **fonte única**: menu, onboarding,
guardas de rota e avisos de trial perguntam todos ali. `usesProduct` tem default
`true` para nenhuma conta anterior ao campo perder o painel.

**Regra que amarra tudo: pelo menos um papel sempre ativo.** Desligar os dois é
recusado em `updateAccountRoles` — uma conta sem papel não teria o que mostrar.

### Conta só-afiliado (`isAffiliateOnly`)

Quem marcou apenas "afiliado" vê um painel enxuto:

- **Menu** sem as telas do produto (`navFor` em `(dashboard)/layout.tsx`);
- **Sem onboarding** do agente — não há WhatsApp para conectar, e o wizard seria
  um beco sem saída;
- **Sem indicador de uso** na navegação e **sem "7 dias grátis"** no cadastro: o
  trial é de *mensagens da IA*, que essa conta não gasta. Prometê-lo sugeriria,
  ainda por cima, que o programa de afiliados expira;
- **`/relatorios`** abre direto na visão de afiliados, sem seletor de abas;
- **`/planos`** redireciona para `/afiliado` — não há o que assinar;
- **Rodapé e logo** apontam para `/afiliado`, não `/inicio`.

Esconder item de menu **não é autorização**: as rotas do produto são protegidas
no servidor por `requireProductAccess()` (`lib/require-product.ts`), montado
como `layout.tsx` em cada pasta do produto para valer também nas rotas filhas
(ex.: `/agentes/[id]`).

### Sair do programa: `OPTED_OUT`, não `SUSPENDED`

Desmarcar "ser afiliado" em `/configuracoes` grava `OPTED_OUT`, um status
separado do bloqueio do admin (`SUSPENDED`):

- **Nada é apagado** — código, indicações e comissões continuam salvos, e
  reativar devolve o **mesmo link** (apagar destruiria histórico de dinheiro e
  mataria links já divulgados);
- Some do menu (`isAffiliate` fica `false`) e o link para de creditar novas
  indicações (`findActiveAffiliateByCode` e `attachReferralToTenant` exigem
  `ACTIVE`), mas o extrato antigo permanece;
- `SUSPENDED` continua aparecendo no menu de propósito: a pessoa precisa **ver**
  o aviso do bloqueio, com o texto "fale com o suporte" — mensagem errada para
  quem saiu por vontade própria.

Comissão nova só corre para afiliado `ACTIVE` (`recordCommissionForPayment`).

**Crédito é first-touch e único.** `Referral.tenantId` é `@unique`: um tenant só
pode ser creditado a um afiliado, o primeiro que o trouxe. Um segundo link não
rouba a venda, e o cookie (`REFERRAL_COOKIE`) não é sobrescrito se já existir.

**Dinheiro em basis points e centavos, sempre inteiro.** `commissionBps`
(2000 = 20%) e valores em centavos. Float em dinheiro acumula erro.
`commissionOf()` arredonda para baixo — o centavo quebrado fica com a casa.

**O percentual é progressivo (`COMMISSION_TIERS`).** Não existe taxa fixa:

| Nível | Vendas ativas | Comissão |
| --- | --- | --- |
| Bronze | a partir da 1ª | 5% |
| Prata | 5+ | 10% |
| Ouro | 25+ | 15% |
| Diamante | 100+ | 20% |

"Venda" é um `Referral` com status `CONVERTED` (assinou e não cancelou), de
qualquer plano — `countActiveSales()`. Quem cancela sai da contagem, então o
nível reflete a **carteira viva**, não um recorde histórico; é a mesma base do
"assinantes ativos" do painel, de propósito, para a tela nunca divergir do que o
webhook aplica. O nível vale para **todas** as assinaturas, não só as novas: ao
subir, a carteira inteira passa a render mais.

A venda que está sendo convertida conta para a própria faixa (a mensalidade que
fecha a 5ª venda já sai a 10%) — ver `salesForTier` em
`recordCommissionForPayment`.

`Affiliate.commissionBps` continua existindo como **override do admin**: quando
preenchido, é um acordo particular e ganha do programa de níveis (o painel
mostra "Personalizado" e esconde a escada).

**O percentual é congelado na linha da comissão.** `AffiliateCommission` guarda
`baseAmountCents`, `amountCents` **e** `commissionBps`. Mudar a regra amanhã não
reescreve o que já foi ganho.

**A comissão nasce em `invoice.paid`, não no checkout.** É o único evento do
Stripe que dispara em toda renovação, e só depois de o dinheiro entrar. A base é
`invoice.amount_paid` (o que a pessoa realmente pagou), não o preço de tabela —
assim desconto e proporcional entram certos. O `tenantId`/`planKey` vem de
`invoice.parent.subscription_details.metadata`, gravado por
`createCheckoutSession` via `subscription_data`.

**Idempotência do webhook.** `stripeEventId` é `@unique`. O Stripe reentrega
eventos; sem essa trava a mesma fatura pagaria comissão duas vezes. A violação
P2002 é capturada e vira `null`, não erro.

**Estorno escuta `credit_note.created`,** e não `charge.refunded`: só a nota de
crédito diz qual fatura foi estornada (o `Charge` não expõe mais a fatura na API
atual), e é a fatura que amarra a comissão.

**Maturação sem cron.** `approveMaturedCommissions()` roda sob demanda ao abrir
o painel/relatório: libera para saque o que passou de `COMMISSION_HOLD_DAYS`.

## Onde isso aparece

- **Landing pública:** `src/app/(marketing)/afiliados/` (+ teaser na home e
  links na Navbar/Footer). O simulador usa os preços reais de `billing/plans`.
- **Captura do `?ref=`:** `src/proxy.ts` grava o cookie (cobre toda rota pública
  do matcher); `_components/ReferralTracker.tsx` + `/api/afiliados/clique`
  registram só a métrica de clique (o proxy roda em prefetch e infla a contagem).
- **Atribuição:** `src/app/api/register/route.ts`, como efeito colateral do
  cadastro — falha ali nunca derruba a criação da conta.
- **Painel:** `src/app/(dashboard)/afiliado/` (links por plano, nível, funil,
  extrato, dados de Pix). A aba no menu só aparece para quem está no programa.
- **Relatórios:** terceira aba (`?visao=afiliados`) com a evolução mensal.
- **Troca de papéis:** card "Como você usa o fechai" em `/configuracoes`
  (`RolesForm.tsx` + `updateAccountRoles` em `configuracoes/actions.ts`). Salvar
  revalida `("/", "layout")` — sem isso o menu ficaria desatualizado.

## Fluxo, do clique ao saque

1. Alguém abre `/?ref=CODIGO` → proxy grava o cookie (30 dias).
2. Cria a conta → `attachReferralToTenant` marca `SIGNED_UP` e limpa o cookie.
3. Assina um plano → `invoice.paid` → `recordCommissionForPayment` cria a
   comissão `PENDING` e o referral vira `CONVERTED`.
4. Todo mês que renovar → nova linha de comissão (é aqui que mora o "recorrente").
5. Passados 30 dias → `APPROVED` (sacável a partir de `MIN_PAYOUT_CENTS`).
6. Cancelou → `markReferralChurned`: para de gerar comissão nova, o ganho
   anterior permanece.
