"use client";

import { useActionState, useState } from "react";
import { Plus, X } from "lucide-react";
import { PLANS } from "@/modules/billing/plans";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Field, fieldProps } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { createAccount } from "../../actions";

export function NewAccountForm() {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(createAccount, null);
  const [copyError, setCopyError] = useState<string | null>(null);

  if (!open) {
    return (
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <Plus size={15} aria-hidden />
        Nova conta
      </Button>
    );
  }

  return (
    <div className="rounded-surface border border-white/10 bg-white/5 p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold text-white">Criar conta</h2>
          <p className="mt-0.5 text-sm text-white/60">
            Cria o tenant, o usuário e a configuração base — a pessoa já entra usando.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Fechar formulário de nova conta"
          onClick={() => setOpen(false)}
        >
          <X size={18} aria-hidden />
        </Button>
      </div>

      {/* Credenciais recém-criadas — só aparecem uma vez */}
      {state?.ok && (
        <Alert tone="success" title={`Conta criada: ${state.email}`} className="mb-5">
          {state.tempPassword ? (
            <>
              <p className="text-white/70">
                Senha provisória — copie agora, ela não será mostrada de novo.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="rounded bg-black/40 px-3 py-2 font-mono text-sm text-white">
                  {state.tempPassword}
                </code>
                <CopyButton
                  value={state.tempPassword}
                  label="Copiar senha"
                  onCopyError={setCopyError}
                />
              </div>
              {copyError && <p className="mt-2 text-white/70">{copyError}</p>}
            </>
          ) : (
            <p className="text-white/70">Use a senha que você definiu.</p>
          )}
        </Alert>
      )}

      {/*
        A limpeza pós-sucesso era um `useEffect` que chamava `form.reset()` e
        `setRole("OWNER")` — setState dentro de efeito, com renderização em
        cascata. Trocar a `key` remonta o formulário: os campos voltam ao
        `defaultValue` e o estado interno some junto, sem efeito nenhum.
        Em caso de erro a key não muda, então o que a pessoa digitou fica lá.
      */}
      <AccountFields
        key={state?.ok ? `criada-${state.email}` : "rascunho"}
        formAction={formAction}
        pending={pending}
        error={state?.ok ? undefined : state?.error}
      />
    </div>
  );
}

function AccountFields({
  formAction,
  pending,
  error,
}: {
  formAction: (formData: FormData) => void;
  pending: boolean;
  error?: string;
}) {
  const [role, setRole] = useState("OWNER");

  return (
    <form action={formAction} className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Nome da conta" htmlFor="na-tenant">
          <Input
            {...fieldProps("na-tenant")}
            name="tenantName"
            required
            placeholder="Ex: Estúdio Aurora"
          />
        </Field>

        <Field label="E-mail de acesso" htmlFor="na-email">
          <Input
            {...fieldProps("na-email")}
            name="email"
            type="email"
            required
            autoComplete="off"
            placeholder="pessoa@negocio.com.br"
          />
        </Field>

        <Field label="Tipo de conta" htmlFor="na-role">
          <Select
            {...fieldProps("na-role")}
            name="role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            <option value="OWNER">Cliente (owner do tenant)</option>
            <option value="SUPERADMIN">Superadmin (painel administrativo)</option>
          </Select>
        </Field>

        <Field label="Plano" htmlFor="na-plan">
          <Select {...fieldProps("na-plan")} name="planKey" defaultValue="FREE">
            {PLANS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field
        label="Senha"
        htmlFor="na-password"
        hint="Deixe vazio para gerar uma senha provisória."
        optional
      >
        <Input
          {...fieldProps("na-password", { hint: true })}
          name="password"
          type="text"
          autoComplete="new-password"
          placeholder="mínimo de 6 caracteres"
        />
      </Field>

      {role === "SUPERADMIN" && (
        <Alert tone="warn">
          Superadmin enxerga e altera todas as contas da plataforma, incluindo planos e suspensões.
        </Alert>
      )}

      {error && <Alert tone="danger">{error}</Alert>}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={pending} loadingLabel="Criando conta">
          Criar conta
        </Button>
        <span className="font-mono text-micro uppercase tracking-[0.15em] text-white/55">
          a pessoa entra por /login
        </span>
      </div>
    </form>
  );
}
