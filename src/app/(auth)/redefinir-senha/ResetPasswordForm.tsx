"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PasswordStrength } from "@/components/ui/password-strength";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";
import { PasswordField } from "../_components/fields";
import { resetPassword, type ResetPasswordState } from "./actions";

export function ResetPasswordForm({ token, email }: { token: string; email: string }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ResetPasswordState, FormData>(
    resetPassword,
    null,
  );
  // Controlados para alimentar a checklist de força e comparar as duas senhas
  // antes do envio — errar a confirmação e só descobrir depois do round-trip é
  // frustração desnecessária.
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const mismatch = confirm.length > 0 && confirm !== password;

  useEffect(() => {
    // O `?reset=1` faz o login mostrar "Senha alterada". Sem redirecionar, a
    // pessoa ficaria olhando um formulário cujo token já não vale mais.
    if (state?.ok) router.replace("/login?reset=1");
  }, [state?.ok, router]);

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-ink">Criar nova senha</h1>
      <p className="mt-1 text-sm text-neutral">
        Conta: <span className="font-medium break-all text-ink">{email}</span>
      </p>

      <form action={formAction} className="mt-8 space-y-4">
        <input type="hidden" name="token" value={token} />

        <div>
          <PasswordField
            label="Nova senha"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            hint="Use algo que só você saiba — e diferente da anterior."
            value={password}
            onValueChange={setPassword}
          />
          <PasswordStrength password={password} />
        </div>

        <PasswordField
          label="Repita a nova senha"
          name="confirmPassword"
          autoComplete="new-password"
          value={confirm}
          onValueChange={setConfirm}
          error={mismatch ? "As duas senhas precisam ser iguais." : null}
        />

        {state?.error && <Alert tone="danger">{state.error}</Alert>}

        <Button
          type="submit"
          variant="cta"
          className="w-full"
          disabled={mismatch || password.length === 0}
          loading={pending}
          loadingLabel="Salvando a nova senha"
        >
          Salvar e entrar
        </Button>
      </form>
    </div>
  );
}
