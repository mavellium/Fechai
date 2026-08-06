"use client";

import { useActionState, useId } from "react";
import { FormFeedback } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, fieldProps } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { updateProfile } from "./actions";

export function ProfileForm({ name, email }: { name: string; email: string }) {
  const [state, formAction, pending] = useActionState(updateProfile, null);
  const nameId = useId();
  const emailId = useId();

  return (
    <form action={formAction} className="space-y-5">
      <Field label="Nome" htmlFor={nameId}>
        <Input {...fieldProps(nameId)} name="name" defaultValue={name} required />
      </Field>

      <Field
        label="E-mail"
        htmlFor={emailId}
        hint="Usado para entrar na conta — não pode ser alterado por aqui."
      >
        <Input {...fieldProps(emailId, { hint: true })} value={email} disabled readOnly />
      </Field>

      <FormFeedback error={state?.error} info={state?.info} />

      <Button type="submit" loading={pending} loadingLabel="Salvando perfil">
        Salvar perfil
      </Button>
    </form>
  );
}
