# ADR-002 — Stripe Checkout com price_data inline

## Contexto

O fluxo pago precisa de preços na Stripe. A abordagem tradicional exige criar Produtos/Preços no dashboard e guardar os `price_id` em env. Isso adiciona setup manual e acopla o ambiente a IDs externos — atrito para um MVP autoatendimento.

## Decisão

Criar as Checkout Sessions com `price_data` **inline** (moeda, valor, `recurring.interval`, nome do produto) derivado de `src/modules/billing/plans.ts`. Nenhum preço pré-cadastrado é necessário — basta `STRIPE_SECRET_KEY`.

## Consequência

- Setup de pagamento = só a secret key (+ `STRIPE_WEBHOOK_SECRET` para o webhook). Zero cliques no dashboard.
- `plans.ts` é a fonte única de verdade de valores.
- Trade-off: sem catálogo de preços reutilizável na Stripe e sem relatórios por preço no dashboard deles. Aceitável no MVP; migrar para Prices nomeados é trivial depois (trocar `price_data` por `price`).
- `Tenant.planKey` só muda via webhook (`checkout.session.completed` / `customer.subscription.*`), mantendo o banco como reflexo do estado da Stripe.
