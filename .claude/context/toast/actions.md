# toast — Actions (o que dispara toast)

## useActionToast(state, pending, context, { retry? }) → SaveStatus
- **Para:** formulário com `useActionState` (ou `useState<Result>` + `useTransition`).
- **Fluxo:** `pending` → `announceLoading`; ao terminar → `announceResult` no mesmo `id`.
- **Dedupe:** cada retorno novo notifica (identidade do objeto), inclusive o mesmo erro 2×; fim do `pending` também conta.
- **Não apaga:** se o form zera o retorno (`setState(null)`) ao editar, o toast na tela fica.
- **Cleanup:** desmontar com "Salvando…" na tela → `dismiss`. Sem provider → no-op.
- **Retorno:** `pending ? "loading" : readResult(state).status`.

## useSaveFeedback(context) → { status, saving, run, reset }
- **run(task):** `try/catch/finally`; nunca lança; duplo clique reaproveita o envio em curso.
- **Exceção:** vira `errorToResult`; redirect/notFound do Next (`digest: NEXT_*`) é **relançado**.
- **Retry:** "Tentar novamente" chama o `run` mais recente (via `runRef`).

## announceResult(sink, id, ctx, result, retry?) → SaveStatus (`announce.ts`)
- null/`{}` → `dismiss(id)`; sucesso → `successMessage`; falha → `failureMessage` + ação:
  auth → `{ label: "Entrar", href: "/login" }`; retryable + `retry` → "Tentar novamente".
- `announceLoading(sink, id, ctx)` → `loadingMessage`.

## requestSave(input, init) → ActionResult (`save-service.ts`)
- `fetch` que **nunca lança** (exceto `AbortError`): 2xx → `{ ok: true, info? }`; 401/403/400/422/5xx → `code` por `classifyFailure`; `fetch` lançando → `{ ok: false, code: "network" }`.
- Corpo lido: `error`/`message` (passa por `sanitizeReason`), `errors` só `string | string[]`.
- `errorToResult(e)` e `isFrameworkSignal(e)` (digest `NEXT_*`) no mesmo arquivo.

## ToastApi (`useToast()` / `useOptionalToast()`)
`show(input) → id`, `dismiss(id)`, `dismissAll()`, atalhos `loading|success|warning|error|info(title, opts?)`.
`useToast` lança sem Provider; `useOptionalToast` devolve `null`.
