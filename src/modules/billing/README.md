# Módulo: billing

## O que faz

Planos do SaaS e cobrança via Stripe (modo teste no MVP). Fluxo grátis não usa Stripe; fluxo pago usa Checkout + Webhook para provisionar/atualizar o plano do tenant.

## Arquivos

- `plans.ts` — fonte única dos planos (`PLANS`, `PLAN_BY_KEY`). Usado na landing, na seleção de plano e no checkout.
- `usage.ts` — `getUsageSummary(tenantId)`: conversas reais (não teste) com atividade no mês corrente vs. o limite efetivo (override do admin ou o teto do plano), além do teto por conversa (`perConversationCap` = override próprio do admin, senão limite efetivo × 3) e seu uso real (`perConversationUsed` = respostas da conversa mais ativa no mês). Alimenta o enforcement (`runAgentTurn`), o indicador da navegação e o card "Uso atual" de /configuracoes.
- `stripe.ts` — `getStripe()` (lazy) e `isStripeConfigured()`.
- `checkout.ts` — `createCheckoutSession()` com `price_data` inline (ver ADR-002).
- `service.ts` — `setTenantPlan()` (idempotente) e `isValidPlan()`. Overrides de limite moram em `modules/admin/service.ts` (`adminSetUsageLimit`) e nos campos `Tenant.conversationLimitOverride` e `Tenant.perConversationCapOverride`.

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

A cota de conversas/mês é aplicada em `runAgentTurn` (orchestrator): com `used >= limit`,
a mensagem fica registrada, a conversa sobe para "precisa de você" e a IA fica em
silêncio (`TurnStatus = "limit_reached"`). WhatsApp não envia nada; o widget responde um
aviso curto; o sandbox passa `skipUsageCheck: true` (testar não é atendimento). Respostas
manuais (`sendManualReply`) nunca são bloqueadas.

Há também um teto **por conversa** (`perConversationCap`): por padrão é o limite efetivo × 3,
mas o admin pode fixar um override próprio (`perConversationCapOverride`) — as duas cotas
ficam independentes. A cota da conta é por conversa, então sem esse teto um único chat usaria
o LLM à vontade. Estourar o teto cala a IA só naquela conversa (mesmo `limit_reached`); as
demais seguem atendendo.
