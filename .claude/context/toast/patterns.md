# toast — Padrões (copy-paste)

## Form com useActionState (o padrão do produto)
```tsx
const [state, formAction, pending] = useActionState(updateProfile, null);
useActionToast(state, pending, { entity: "perfil", action: "update" });
// sem <FormFeedback>: o toast é o retorno. Botão: <Button loading={pending}>
```
Gênero/plural: `{ entity: "regras", gender: "f", plural: true }` → "Regras salvas com sucesso!".

## Envio por fetch
```tsx
const save = useSaveFeedback({ entity: "cliente", action: "create" });
<Button loading={save.saving}
  onClick={() => save.run(() => requestSave("/api/clientes", { method: "POST", body }))}>Salvar</Button>
```

## Server Action (nada muda)
```ts
return { ok: false, error: "Já existe um cliente com este e-mail." }; // erro
return { ok: true, info: "Cliente salvo." };                           // sucesso
return { ok: false, errors: { email: "Obrigatório" } };                // validação
return { ok: false, code: "auth" };                                    // sessão
```

## Dentro de <dialog> modal
```tsx
useActionToast(state, pending, { entity: "contato", action: "create" });
<FormFeedback error={state?.error} info={state?.ok ? state.info : undefined} /> {/* mantém inline */}
```

## Toast avulso
```tsx
const toast = useToast();
const id = toast.loading("Enviando…");
toast.show({ id, kind: "success", title: "Enviado!" }); // troca no lugar
```
