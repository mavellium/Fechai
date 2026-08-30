# Módulo: billing

## O que faz

Planos do SaaS e cobrança via Stripe (modo teste no MVP). Fluxo grátis não usa Stripe; fluxo pago usa Checkout + Webhook para provisionar/atualizar o plano do tenant.

## Arquivos

- `plans.ts` — fonte única dos planos (`PLANS`, `PLAN_BY_KEY`). Usado na landing, na seleção de plano e no checkout. Tabela atual:

  | Plano | Preço | Mensagens/mês | Agentes | Ações | Teste |
  |---|---|---|---|---|---|
  | Grátis | R$ 0 | 100 | 1 | 2 | 7 dias |
  | Starter | R$ 199 | 3.000 | 3 | 3 | — |
  | Pro | R$ 399 | 9.000 | 5 | todas | — |
  | Business | R$ 899 | 30.000 | 10 | todas | — |

- `usage.ts` — `getUsageSummary(tenantId)`: respostas da IA no mês corrente (conversas reais; sandbox fora) vs. a cota efetiva (`messageLimitOverride` do admin, senão `messagesPerMonth` do plano). Resolve também o período de teste (`isTrial`, `trialEndsAt`, `trialExpired`, `trialDaysLeft`) a partir de `Tenant.trialEndsAt`, e devolve `atLimit` já combinando as duas travas. Alimenta o enforcement (`runAgentTurn`), o `HealthStrip` da home, o indicador da navegação e o card "Uso atual" de /configuracoes.
- `stripe.ts` — `getStripe()` (lazy) e `isStripeConfigured()`.
- `checkout.ts` — `createCheckoutSession()` com `price_data` inline (ver ADR-002).
- `service.ts` — `setTenantPlan()` (idempotente, e sincroniza `trialEndsAt` com o plano) e `isValidPlan()`. O override de cota mora em `modules/admin/service.ts` (`adminSetUsageLimit` → `Tenant.messageLimitOverride`); o período de teste, em `adminSetTrialEndsAt` → `Tenant.trialEndsAt`.

## Contratos expostos

```ts
PLANS: Plan[]; PLAN_BY_KEY: Record<PlanKey, Plan>
createCheckoutSession({ tenantId, planKey, customerEmail?, origin }) -> Stripe.Checkout.Session
setTenantPlan(tenantId, planKey): Promise<void>
```

Rotas: `POST /api/checkout` (cria sessão), `POST /api/plan/free` (grátis), `POST /api/webhooks/stripe` (fonte de verdade do plano). Metadata `{ tenantId, planKey }` viaja na sessão/assinatura e é lida pelo webhook.

## O que NÃO faz

- Não gerencia portal de faturas/cancelamento pela UI ainda.
- Não cria produtos/preços no dashboard da Stripe (usa `price_data` inline).

## Enforcement de uso

**Uma cota só: mensagens.** `used` conta as respostas da IA (`role: "assistant"`,
`sentBy: "agent"`) desde o dia 1 do mês, em conversas reais. Com `used >= limit`,
`runAgentTurn` registra a mensagem do contato, sobe a conversa para "precisa de você" e
cala a IA (`TurnStatus = "limit_reached"`). WhatsApp não envia nada; o widget responde um
aviso curto; o sandbox passa `skipUsageCheck: true` (testar não é atendimento). Respostas
manuais (`sendManualReply`) nunca são bloqueadas.

> Antes eram **duas** cotas — conversas/mês e um teto por conversa — e nenhuma media o que
> custa: uma conversa pode ter 2 ou 200 respostas, e quem consome LLM é a resposta. Contar
> mensagem é contar a coisa certa, e uma cota só é uma cota que o cliente entende. Os campos
> `conversationLimitOverride` / `perConversationCapOverride` deram lugar a
> `messageLimitOverride`.

### Período de teste (plano grátis)

O FREE é um **teste por tempo**, não um plano permanente: `Plan.trialDays = 7`. Toda conta
criada num plano com `trialDays` nasce com `Tenant.trialEndsAt = agora + trialDays`
(`createTenantWithOwner`). A conta responde até **100 mensagens E até a data** — acaba o que
vier primeiro (`atLimit = outOfMessages || trialExpired`).

Passada a data, a IA para e **só volta assinando** — mas o painel continua aberto: a pessoa vê
conversas, leads e histórico e pode responder à mão. Bloquear o painel inteiro tiraria dela os
próprios leads já captados, o que não converte, irrita.

`setTenantPlan` mantém a data coerente com o plano: assinar um plano pago limpa `trialEndsAt`
(senão um trial vencido pendurado calaria a IA de quem acabou de pagar); voltar para um plano de
teste reabre a janela a partir de agora. O superadmin estende ou encerra por conta em
/admin/contas (`setTenantTrial` → `adminSetTrialEndsAt`).
