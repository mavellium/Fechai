"use client";

import { useActionState, useRef } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, fieldProps } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { FormFeedback } from "@/components/ui/alert";
import type { AgentUsage } from "@/modules/agent-engine/agents";
import { createAgentAction } from "./actions";

/**
 * Criação de agente. Só o nome — o resto é o passo a passo da própria tela do
 * agente, para onde a action redireciona. Pedir persona inteira aqui era o
 * jeito antigo (formulário de 7 campos de cara, sem contexto).
 */
export function NewAgentButton({ usage }: { usage: AgentUsage }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [state, formAction, pending] = useActionState(createAgentAction, null);

  if (!usage.canCreate) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled
        title={`Seu plano permite ${usage.limit} agente(s)`}
      >
        <Plus size={14} aria-hidden />
        Novo agente
      </Button>
    );
  }

  return (
    <>
      <Button type="button" size="sm" onClick={() => ref.current?.showModal()}>
        <Plus size={14} aria-hidden />
        Novo agente
      </Button>

      <dialog
        ref={ref}
        aria-labelledby="novo-agente-titulo"
        className="w-[min(28rem,92vw)] rounded-surface border border-white/10 bg-ink p-6 text-white backdrop:bg-ink/70"
      >
        <h2 id="novo-agente-titulo" className="font-display text-xl font-bold">
          Novo agente
        </h2>
        <p className="mt-1 text-sm text-white/65">
          Dê um nome que diga o que ele faz — “Vendas”, “Suporte”, “Unidade Centro”.
        </p>

        <form action={formAction} className="mt-5 space-y-4">
          <Field label="Nome do agente" htmlFor="novo-agente-nome">
            <Input
              {...fieldProps("novo-agente-nome")}
              name="name"
              autoFocus
              required
              maxLength={60}
              placeholder="Ex: Vendas"
            />
          </Field>

          <FormFeedback error={state?.error} />

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
            <Button type="submit" size="sm" loading={pending} loadingLabel="Criando agente">
              Criar e configurar
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
