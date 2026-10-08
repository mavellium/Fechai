# Bitrix24 — padrões

Guard (`bitrix-actions.ts`):

```ts
const access = await guard();
if (!access.active) return inactive;
```

Formulário (`BitrixCard.tsx`):

```tsx
const [result, action, pending] = useActionState(saveBitrixAction, null);
useActionToast(result, pending, { entity: "conexão Bitrix24", gender: "f" });
```

UnsavedForm; sucesso atualiza router.

Escrita externa (`mirror.ts`):

```ts
await persist(ctx, { uncertain: kind });
try { return await run(); }
```

Uncertain ANTES do POST, ID logo depois; falha ambígua só busca origem. reference inclui tenant/destino/tipo/ID. Cancelar nunca exclui.

Testes: tests/bitrix-*.test.ts; smoke local com REST simulado. Portal real exige webhook.
