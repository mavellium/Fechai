# Módulo: admin

## O que faz

Gestão da plataforma pelo SUPERADMIN: **criar contas**, listar/inspecionar tenants, suspender/reativar e trocar plano manualmente (suporte). Feedbacks ficam no módulo `feedback/`; a trilha de auditoria (`/admin/logs`, incluindo desfazer alterações e exclusões) fica em `modules/audit/`.

## Excluir conta: quem pode ser excluído

`deleteTenantAccount` (server action em `(admin)/actions.ts`) exige a conta **suspensa** e recusa a conta do próprio admin logado. Conta de **admin também pode ser excluída** — antes eram todas recusadas em bloco, o que deixava admin desligado preso na lista para sempre e empurrava a limpeza para o banco à mão, sem rastro. A regra que importa não é "é admin?", é "sobra algum admin depois?": a action conta os `SUPERADMIN` fora do tenant alvo no momento do clique e recusa se o resultado for zero, porque sem nenhum o `/admin` fica inacessível pela interface (só `npm run db:admin` no servidor devolve). Toda exclusão é registrada em `AuditLog` **antes** do delete, com snapshot da conta — é irreversível, e o log é o que resta dela.

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
