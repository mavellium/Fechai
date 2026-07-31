# Módulo: admin

## O que faz

Gestão da plataforma pelo SUPERADMIN: **criar contas**, listar/inspecionar tenants, suspender/reativar e trocar plano manualmente (suporte). Feedbacks ficam no módulo `feedback/`.

## Arquivos

- `service.ts`:
  - `listTenants(search?)` — tenants + status WhatsApp + papéis dos usuários + contagens.
  - `getTenantDetail(tenantId)` — usuários, contagens, etc.
  - `setTenantStatus(tenantId, "active"|"suspended")`.
  - `adminSetPlan(tenantId, planKey)`.
  - `adminCreateAccount({tenantName, email, password?, role, planKey})` — cria tenant + usuário com **qualquer papel e plano**. Sem `password`, gera uma provisória e a devolve em `tempPassword` (única vez que ela existe em texto). Delega o provisionamento a `createTenantWithOwner`.

## Contratos expostos

```ts
listTenants(search?) ; getTenantDetail(id)
setTenantStatus(id, status) ; adminSetPlan(id, planKey)
adminCreateAccount(input) -> { ok: true, tempPassword? } | { ok: false, error }
```

## Autorização

**Todas** são cross-tenant e assumem SUPERADMIN. A checagem fica na rota `(admin)/` (`requireSuperadmin`) e nas server actions do painel — nunca exponha estas funções a rotas do cliente.

## O que NÃO faz

- Não faz billing real (trocar plano aqui é manual, não mexe na Stripe).
- Não edita persona/base de um tenant (isso é do próprio cliente).
