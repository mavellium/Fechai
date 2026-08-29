# Módulo: billing

## O que faz

Planos do SaaS e cobrança via Stripe (modo teste no MVP). Fluxo grátis não usa Stripe; fluxo pago usa Checkout + Webhook para provisionar/atualizar o plano do tenant.

## Arquivos

- `plans.ts` — fonte única dos planos (`PLANS`, `PLAN_BY_KEY`). Usado na landing, na seleção de plano e no checkout. Cada plano define `conversationsPerMonth` (cota da conta) **e** `perConversationCapDefault` (teto numa única conversa): os dois são fixos, nenhum derivado do outro. Tabela atual: Grátis R$ 0 · 10 conv · 100 resp · 1 agente · 2 ações · 7 dias ilimitado; Starter R$ 199 · 1.000 conv · 150 resp · 3 agentes · 3 ações; Pro R$ 399 · 3.000 conv · 200 resp · 5 agentes · todas as ações; Business R$ 899 · 10.000 conv · 300 resp · 10 agentes · todas as ações.
- `usage.ts` — `getUsageSummary(tenantId)`: conversas reais (não teste) com atividade no mês corrente vs. o limite efetivo (override do admin ou o teto do plano), além do teto por conversa (`perConversationCap` = override próprio do admin, senão `perConversationCapDefault` do plano; o fallback `limite × 3` só sobrou para um plano futuro que entre sem o campo) e seu uso real (`perConversationUsed` = respostas da conversa mais ativa no mês). Também resolve o trial de uso ilimitado (`unlimitedTrial`, `trialEndsAt`) a partir de `Tenant.trialUnlimitedUntil`. Alimenta o enforcement (`runAgentTurn`), o indicador da navegação e o card "Uso atual" de /configuracoes.
- `stripe.ts` — `getStripe()` (lazy) e `isStripeConfigured()`.
- `checkout.ts` — `createCheckoutSession()` com `price_data` inline (ver ADR-002).
- `service.ts` — `setTenantPlan()` (idempotente) e `isValidPlan()`. Overrides de limite moram em `modules/admin/service.ts` (`adminSetUsageLimit`) e nos campos `Tenant.conversationLimitOverride` e `Tenant.perConversationCapOverride`. O trial ilimitado usa `adminSetTrialUnlimitedUntil` e `Tenant.trialUnlimitedUntil`.

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

Há também um teto **por conversa** (`perConversationCap`): por padrão é o `perConversationCapDefault`
do plano (todos os planos definem o seu), mas o admin pode fixar um override
próprio (`perConversationCapOverride`) — as duas cotas ficam independentes. A cota da conta é
por conversa, então sem esse teto um único chat usaria o LLM à vontade. Estourar o teto cala a
IA só naquela conversa (mesmo `limit_reached`); as demais seguem atendendo.

### Trial de uso ilimitado

Todo tenant FREE nasce com `Tenant.trialUnlimitedUntil` = agora + 7 dias (`FREE_TRIAL_DAYS` em
`modules/tenants/provision.ts`). Enquanto essa data estiver no futuro, `getUsageSummary` retorna
`unlimitedTrial: true` e `runAgentTurn` pula as duas checagens de cota inteiras — a IA responde
sem limite, e "Uso atual" (/configuracoes) e o indicador da navegação mostram um estado
"ilimitado · N dias" no lugar da barra normal. O superadmin ajusta isso por conta em
/admin/contas (`setTenantTrial` → `adminSetTrialUnlimitedUntil`), em qualquer plano — não só FREE.
