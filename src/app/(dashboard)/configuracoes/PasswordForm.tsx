"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { FormFeedback } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, fieldProps } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { changePassword } from "./actions";

export function PasswordForm() {
  const [state, formAction, pending] = useActionState(changePassword, null);
  const [show, setShow] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const currentId = useId();
  const newId = useId();
  const confirmId = useId();
  const type = show ? "text" : "password";

  // Sucesso limpa os campos — senha antiga/nova não devem continuar visíveis no form.
  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-5">
      <Field label="Senha atual" htmlFor={currentId}>
        <Input
          {...fieldProps(currentId)}
          type={type}
          name="currentPassword"
          autoComplete="current-password"
          required
        />
      </Field>

      <Field label="Nova senha" htmlFor={newId} hint="Mínimo de 6 caracteres.">
        <Input
          {...fieldProps(newId, { hint: true })}
          type={type}
          name="newPassword"
          autoComplete="new-password"
          minLength={6}
          required
        />
      </Field>

      <Field label="Confirmar nova senha" htmlFor={confirmId}>
        <Input
          {...fieldProps(confirmId)}
          type={type}
          name="confirmPassword"
          autoComplete="new-password"
          minLength={6}
          required
        />
      </Field>

      <label className="inline-flex w-fit cursor-pointer items-center gap-2 font-mono text-micro uppercase tracking-wide text-white/55 transition-colors hover:text-white/80">
        <input
          type="checkbox"
          checked={show}
          onChange={(e) => setShow(e.target.checked)}
          className="peer sr-only"
        />
        {show ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
        {show ? "Ocultar senhas" : "Mostrar senhas"}
      </label>

      <FormFeedback error={state?.error} info={state?.info} />

      <Button type="submit" loading={pending} loadingLabel="Alterando senha">
        Alterar senha
      </Button>
    </form>
  );
}
