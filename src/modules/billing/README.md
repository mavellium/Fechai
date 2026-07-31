# Módulo: billing

## O que faz

Planos do SaaS e cobrança via Stripe (modo teste no MVP). Fluxo grátis não usa Stripe; fluxo pago usa Checkout + Webhook para provisionar/atualizar o plano do tenant.

## Arquivos

- `plans.ts` — fonte única dos planos (`PLANS`, `PLAN_BY_KEY`). Usado na landing, na seleção de plano e no checkout.
- `stripe.ts` — `getStripe()` (lazy) e `isStripeConfigured()`.
- `checkout.ts` — `createCheckoutSession()` com `price_data` inline (ver ADR-002).
- `service.ts` — `setTenantPlan()` (idempotente) e `isValidPlan()`.

## Contratos expostos

```ts
PLANS: Plan[]; PLAN_BY_KEY: Record<PlanKey, Plan>
createCheckoutSession({ tenantId, planKey, customerEmail?, origin }) -> Stripe.Checkout.Session
setTenantPlan(tenantId, planKey): Promise<void>
```

Rotas: `POST /api/checkout` (cria sessão), `POST /api/plan/free` (grátis), `POST /api/webhooks/stripe` (fonte de verdade do plano). Metadata `{ tenantId, planKey }` viaja na sessão/assinatura e é lida pelo webhook.

## O que NÃO faz

- Não faz enforcement de limites de uso (conversas/mês) — isso entra quando o motor rodar (Milestone 5/6).
- Não gerencia portal de faturas/cancelamento pela UI ainda.
- Não cria produtos/preços no dashboard da Stripe (usa `price_data` inline).
