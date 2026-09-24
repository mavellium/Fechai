"use client";

import { createContext, startTransition, useCallback, useContext, useEffect, useId, useMemo, useRef, type FormHTMLAttributes, type ReactNode, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./button";
import { snapshotForm } from "./unsaved-form-state";

type Entry = {
  label: string;
  isDirty: () => boolean;
  element: () => HTMLElement | null;
  save?: () => Promise<unknown> | unknown;
};
type Guard = {
  register: (id: string, entry: Entry) => () => void;
  confirmNavigation: (proceed: () => void, scope?: HTMLElement | null) => void;
};
const Context = createContext<Guard | null>(null);
const WARNING = "Há alterações não salvas. Deseja continuar sem salvar?";

/** Um aviso compartilhado para abas, links e fechamento/recarregamento. */
export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const entries = useRef(new Map<string, Entry>());
  const dialog = useRef<HTMLDialogElement>(null);
  const nextAction = useRef<(() => void) | null>(null);
  const activeScope = useRef<HTMLElement | null>(null);
  const allowUnload = useRef(false);
  const router = useRouter();
  const titleId = useId();
  const register = useCallback((id: string, entry: Entry) => {
    entries.current.set(id, entry);
    return () => { entries.current.delete(id); };
  }, []);
  const hasChanges = useCallback((scope?: HTMLElement | null) => [...entries.current.values()].some((entry) => {
    const element = entry.element();
    const inScope = !scope || (element && (scope.contains(element) || element.contains(scope)));
    return inScope && entry.isDirty();
  }), []);
  const confirmNavigation = useCallback((proceed: () => void, scope?: HTMLElement | null) => {
    if (!hasChanges(scope)) { proceed(); return; }
    nextAction.current = proceed;
    activeScope.current = scope ?? null;
    dialog.current?.showModal();
  }, [hasChanges]);

  const saveAllChanges = useCallback(async () => {
    const scope = activeScope.current;
    const dirtyEntries = [...entries.current.values()].filter((entry) => {
      const element = entry.element();
      const inScope = !scope || (element && (scope.contains(element) || element.contains(scope)));
      return inScope && entry.isDirty();
    });

    for (const entry of dirtyEntries) {
      if (entry.save) {
        await entry.save();
      } else {
        const element = entry.element();
        if (element instanceof HTMLFormElement) {
          element.requestSubmit();
        } else if (element) {
          const form = element.closest("form");
          if (form) {
            form.requestSubmit();
          } else {
            const submitBtn = element.querySelector<HTMLButtonElement>("button[type='submit']")
              ?? Array.from(element.querySelectorAll<HTMLButtonElement>("button")).find((b) => /salvar/i.test(b.textContent || ""));
            submitBtn?.click();
          }
        }
      }
    }
  }, []);

  useEffect(() => {
    function beforeUnload(event: BeforeUnloadEvent) {
      if (allowUnload.current || !hasChanges()) return;
      event.preventDefault();
      event.returnValue = ""; // O navegador escolhe o texto deste aviso.
    }
    function click(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!anchor || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return;
      const url = new URL(anchor.href, location.href);
      if (!/^https?:$/.test(url.protocol)) return;
      if (url.pathname === location.pathname && url.search === location.search && url.origin === location.origin) return;
      if (!hasChanges()) return;
      event.preventDefault();
      event.stopPropagation();
      confirmNavigation(() => {
        if (url.origin === location.origin) router.push(url.pathname + url.search + url.hash);
        else { allowUnload.current = true; location.assign(url.href); }
      });
    }
    // Sair da conta também é navegação, embora use uma Server Action.
    let authorizedForm: HTMLFormElement | null = null;
    function submit(event: SubmitEvent) {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || !form.hasAttribute("data-leave-page")) return;
      if (authorizedForm === form) { authorizedForm = null; return; }
      if (!hasChanges()) return;
      event.preventDefault();
      event.stopPropagation();
      confirmNavigation(() => { authorizedForm = form; form.requestSubmit(); });
    }
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", click, true);
    document.addEventListener("submit", submit, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", click, true);
      document.removeEventListener("submit", submit, true);
    };
  }, [confirmNavigation, hasChanges, router]);

  // Índices próprios, preservando os campos privados do Next. Permitem voltar
  // à entrada correta se a pessoa cancelar Voltar/Avançar do navegador.
  useEffect(() => {
    const marker = "__fechaiHistoryIndex";
    let current = Number(history.state?.[marker] ?? 0);
    const push = history.pushState.bind(history);
    const replace = history.replaceState.bind(history);
    replace({ ...history.state, [marker]: current }, "");
    const guardedPush: History["pushState"] = (data, unused, url) => {
      current += 1;
      push({ ...data, [marker]: current }, unused, url);
    };
    const guardedReplace: History["replaceState"] = (data, unused, url) => replace({ ...data, [marker]: current }, unused, url);
    history.pushState = guardedPush;
    history.replaceState = guardedReplace;
    let restoring = false;
    function pop(event: PopStateEvent) {
      if (restoring) { restoring = false; event.stopImmediatePropagation(); return; }
      const next = typeof event.state?.[marker] === "number" ? event.state[marker] as number : current - 1;
      if (hasChanges() && !window.confirm(WARNING)) {
        event.stopImmediatePropagation();
        restoring = true;
        history.go(current - next || 1);
      } else current = next;
    }
    window.addEventListener("popstate", pop, true);
    return () => {
      window.removeEventListener("popstate", pop, true);
      if (history.pushState === guardedPush) history.pushState = push;
      if (history.replaceState === guardedReplace) history.replaceState = replace;
    };
  }, [hasChanges]);

  const value = useMemo(() => ({ register, confirmNavigation }), [register, confirmNavigation]);
  return <Context.Provider value={value}>
    {children}
    <dialog ref={dialog} aria-labelledby={titleId} data-surface="dark"
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-surface border border-white/15 bg-ink p-6 text-white backdrop:bg-ink/70"
      onClose={() => { nextAction.current = null; activeScope.current = null; }}>
      <h2 id={titleId} className="font-display text-lg font-semibold">Alterações não salvas</h2>
      <p className="mt-2 text-sm leading-relaxed text-white/65">Você fez alterações que ainda não foram salvas. Deseja continuar mesmo assim?</p>
      {/* Empilhados no celular com a ação principal em cima (`col-reverse`);
          em linha a partir de `sm`, na ordem Voltar · sem salvar · salvar. */}
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            nextAction.current = null;
            activeScope.current = null;
            dialog.current?.close();
          }}
        >
          Voltar
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            const proceed = nextAction.current;
            nextAction.current = null;
            activeScope.current = null;
            dialog.current?.close();
            proceed?.();
          }}
        >
          Continuar sem salvar
        </Button>
        <Button
          type="button"
          variant="default"
          autoFocus
          onClick={async () => {
            const proceed = nextAction.current;
            nextAction.current = null;
            activeScope.current = null;
            await saveAllChanges();
            dialog.current?.close();
            proceed?.();
          }}
        >
          Continuar e salvar
        </Button>
      </div>
    </dialog>
  </Context.Provider>;
}

export function useUnsavedNavigation() {
  const context = useContext(Context);
  return context?.confirmNavigation ?? ((proceed: () => void) => proceed());
}

/** Para editores controlados que não são formulários nativos (regras, voz). */
export function useUnsavedChanges(
  dirty: boolean,
  label: string,
  element?: RefObject<HTMLElement | null>,
  save?: () => Promise<unknown> | unknown
) {
  const context = useContext(Context);
  const id = useId();
  useEffect(() => {
    return context?.register(id, {
      label,
      isDirty: () => dirty,
      element: () => element?.current ?? null,
      save,
    });
  }, [context, dirty, element, id, label, save]);
}

/** Registra também envios automáticos que não passam pelo submit nativo. */
export function trackFormSubmission(form: HTMLFormElement) {
  form.dispatchEvent(new Event("unsaved-form-submit"));
}

/** Só avança a referência salva no sucesso; falhas mantêm o rascunho protegido. */
export function UnsavedForm({ result, label, action, onSubmit, resetOnSuccess = false, ref: suppliedRef, ...props }: Omit<FormHTMLAttributes<HTMLFormElement>, "action"> & {
  result?: { ok?: boolean | string } | null;
  label: string;
  action?: (data: FormData) => void;
  resetOnSuccess?: boolean;
  ref?: RefObject<HTMLFormElement | null>;
}) {
  const localRef = useRef<HTMLFormElement>(null);
  const formRef = suppliedRef ?? localRef;
  const baseline = useRef("");
  const submitted = useRef<string | null>(null);
  const context = useContext(Context);
  const id = useId();
  useEffect(() => {
    const form = formRef.current;
    const capture = () => { submitted.current = snapshotForm(form); };
    form?.addEventListener("unsaved-form-submit", capture);
    return () => form?.removeEventListener("unsaved-form-submit", capture);
  }, [formRef]);
  useEffect(() => {
    baseline.current = snapshotForm(formRef.current);
    return context?.register(id, {
      label,
      element: () => formRef.current,
      isDirty: () => {
        const form = formRef.current;
        const ownerDialog = form?.closest("dialog");
        return Boolean(form && (!ownerDialog || ownerDialog.open)) && snapshotForm(form) !== baseline.current;
      },
    });
  }, [context, formRef, id, label]);
  useEffect(() => {
    if (result?.ok && submitted.current !== null) {
      if (resetOnSuccess) formRef.current?.reset();
      baseline.current = resetOnSuccess ? snapshotForm(formRef.current) : submitted.current;
      submitted.current = null;
    }
  }, [result, resetOnSuccess, formRef]);
  return <form {...props} ref={formRef} onSubmit={(event) => {
    submitted.current = snapshotForm(event.currentTarget);
    if (onSubmit) onSubmit(event);
    if (action && !event.defaultPrevented) {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      startTransition(() => action(data));
    }
  }} />;
}
