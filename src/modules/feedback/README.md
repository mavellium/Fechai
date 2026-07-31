# Módulo: feedback

## O que faz

Captura feedback dos clientes (mensagem + nota opcional 1-5) e permite ao admin listar/filtrar e mudar o status.

## Arquivos

- `service.ts`:
  - `createFeedback(tenantId, message, rating?)` — cliente; sempre no próprio tenant.
  - `listFeedbacks({ tenantId?, status? })` — admin (cross-tenant); inclui o tenant.
  - `setFeedbackStatus(id, status)` — admin. `FEEDBACK_STATUSES = new|read|resolved`.

## Contratos expostos

```ts
createFeedback(tenantId, message, rating?) -> Feedback
listFeedbacks(filter?) -> Feedback[] (com tenant)
setFeedbackStatus(id, status)
```

## O que NÃO faz

- Não autoriza — quem garante SUPERADMIN nas funções cross-tenant é a rota `(admin)/`.
- Não envia notificações ao receber feedback (poderia acionar e-mail depois).
