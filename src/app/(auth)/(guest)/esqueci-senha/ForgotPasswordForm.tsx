"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Clock, MailSearch } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmailField } from "../../_components/fields";
import { requestPasswordReset, type ForgotPasswordState } from "./actions";

export function ForgotPasswordForm({ ttlMinutes }: { ttlMinutes: number }) {
  const [state, formAction, pending] = useActionState<ForgotPasswordState, FormData>(
    requestPasswordReset,
    {},
  );
  const [emailError, setEmailError] = useState<string | null>(null);
  // Depois do envio a tela troca para a confirmação. "Digitei errado" volta ao
  // formulário sem perder o que já foi digitado.
  const [correcting, setCorrecting] = useState(false);

  const sentTo = state.ok ? state.email : null;
  const confirmed = Boolean(sentTo) && !correcting;

  if (confirmed) {
    return (
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">Verifique seu e-mail</h1>
        <p className="mt-1 text-sm leading-relaxed text-neutral">
          Se existir uma conta para{" "}
          <span className="font-medium break-all text-ink">{sentTo}</span>, o link para criar uma
          nova senha já está a caminho.
        </p>

        <ul className="mt-6 space-y-3 rounded-surface border border-ink/10 bg-white p-4">
          <li className="flex items-start gap-2.5 text-sm leading-relaxed text-neutral">
            <Clock size={16} className="mt-0.5 shrink-0 text-iris" aria-hidden />
            <span>
              O link vale por{" "}
              <span className="font-medium text-ink">{ttlMinutes} minutos</span> e só funciona uma
              vez.
            </span>
          </li>
          <li className="flex items-start gap-2.5 text-sm leading-relaxed text-neutral">
            <MailSearch size={16} className="mt-0.5 shrink-0 text-iris" aria-hidden />
            <span>
              Não chegou? Procure por <span className="font-medium text-ink">fechai</span> no spam e
              na lixeira antes de pedir outro.
            </span>
          </li>
        </ul>

        {state.error && (
          <Alert tone="danger" className="mt-4">
            {state.error}
          </Alert>
        )}

        <div className="mt-6 space-y-3">
          <form action={formAction}>
            <input type="hidden" name="email" value={sentTo ?? ""} />
            <Button
              type="submit"
              variant="outline"
              className="w-full"
              loading={pending}
              loadingLabel="Reenviando"
            >
              Enviar de novo
            </Button>
          </form>

          <button
            type="button"
            onClick={() => setCorrecting(true)}
            className="w-full rounded-control py-1 text-center text-sm text-neutral transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
          >
            Digitei o e-mail errado
          </button>
        </div>

        <p className="mt-8 text-center text-sm text-neutral">
          <Link href="/login" className="font-medium text-iris hover:underline">
            Voltar para o login
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-ink">Recuperar acesso</h1>
      <p className="mt-1 text-sm leading-relaxed text-neutral">
        Informe o e-mail da sua conta. Enviamos um link para você criar uma senha nova.
      </p>

      <form
        action={formAction}
        onSubmit={() => setCorrecting(false)}
        noValidate
        className="mt-8 space-y-4"
      >
        <EmailField
          error={emailError}
          onValidate={setEmailError}
          defaultValue={state.email}
          autoFocus
        />

        {state.error && <Alert tone="danger">{state.error}</Alert>}

        <Button
          type="submit"
          variant="cta"
          className="w-full"
          disabled={Boolean(emailError)}
          loading={pending}
          loadingLabel="Enviando o link"
        >
          Enviar link de redefinição
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-neutral">
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 font-medium text-iris hover:underline"
        >
          <ArrowLeft size={14} aria-hidden />
          Voltar para o login
        </Link>
      </p>
    </div>
  );
}
