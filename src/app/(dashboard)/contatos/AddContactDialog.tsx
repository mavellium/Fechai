"use client";

import { useEffect, useRef } from "react";
import { useActionState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, fieldProps } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { FormFeedback } from "@/components/ui/alert";
import { addContact } from "./actions";

/**
 * Cadastro manual de contato. Sem ele, só entram na lista quem escreveu para o
 * número — aqui o dono da conta adiciona qualquer WhatsApp e já pode disparar.
 */
export function AddContactDialog({ label = "Novo contato" }: { label?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [state, formAction, pending] = useActionState(addContact, null);

  useEffect(() => {
    if (state?.ok) ref.current?.close();
  }, [state]);

  return (
    <>
      <Button type="button" size="sm" onClick={() => ref.current?.showModal()}>
        <Plus size={14} aria-hidden />
        {label}
      </Button>

      <dialog
        ref={ref}
        aria-labelledby="novo-contato-titulo"
        className="w-[min(28rem,92vw)] rounded-surface border border-white/15 bg-ink p-6 text-white backdrop:bg-ink/70"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id="novo-contato-titulo" className="font-display text-lg font-semibold">
              Novo contato
            </h2>
            <p className="mt-1 text-sm text-white/55">
              Adicione um WhatsApp e envie uma mensagem quando quiser.
            </p>
          </div>
          <button
            type="button"
            onClick={() => ref.current?.close()}
            aria-label="Fechar"
            className="shrink-0 rounded-control p-1 text-white/60 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        <form action={formAction} className="space-y-4">
          <Field label="Nome" htmlFor="novo-contato-nome" optional>
            <Input
              {...fieldProps("novo-contato-nome")}
              name="name"
              autoFocus
              maxLength={80}
              placeholder="Ex: Ana Souza"
            />
          </Field>

          <Field label="Telefone" htmlFor="novo-contato-phone" hint="Formato livre — ex.: 11 99999-9999">
            <Input
              {...fieldProps("novo-contato-phone")}
              name="phone"
              inputMode="tel"
              autoComplete="tel"
              required
              placeholder="(11) 99999-9999"
            />
          </Field>

          <FormFeedback error={state?.error} info={state?.ok ? state.info : undefined} />

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => ref.current?.close()}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button type="submit" size="sm" loading={pending} loadingLabel="Adicionando contato">
              Adicionar
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
