# toast — Queries (leitura e classificação, sem efeito)

## readResult(result) (`messages.ts`)
- **Retorna:** `{ status: "idle" } | { status: "success", message: string|null } | { status: "error", input: FailureInput }`.
- `message` = `ok` quando string, senão `info`. `null`/`{}` = idle.

## classifyFailure({ status?, code?, message?, errors? }) → FailureKind
- **Ordem:** `code` → status (401 auth, 403 forbidden, 400/422 validation, 0 network) → `errors` não vazio (validation) → regex no texto (sessão expirou, sem permissão, failed to fetch) → `server`.

## sanitizeReason(raw) → string | null
- `null` se não for texto seguro para gente (ver invariantes em [domain.md](domain.md)).

## invalidFieldNames(errors, labels?) → string[]
- Rótulo de `fieldLabels` ou o nome do campo humanizado (`camelCase`/`snake_case` → "camel case").

## Mensagens puras
- `loadingMessage(ctx)` → "Salvando cliente…"; `successMessage(ctx, fromServer?)` → "Cliente salvo com sucesso!" (o texto da action vence); `failureMessage(ctx, input)` → `{ kind, title, description, failure, retryable }`.

## Hooks de leitura
- `useOptionalToast()` → `ToastApi | null` (seguro em telas sem Provider: login, cadastro).
- Uso: `const toast = useOptionalToast(); toast?.info("Copiado")`.
