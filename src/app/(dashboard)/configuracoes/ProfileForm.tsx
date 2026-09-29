"use client";

import { useActionState, useId } from "react";
import { useActionToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Field, fieldProps } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { updateProfile } from "./actions";
import { UnsavedForm } from "@/components/ui/unsaved-changes";

export function ProfileForm({ name, email }: { name: string; email: string }) {
  const [state, formAction, pending] = useActionState(updateProfile, null);
  useActionToast(state, pending, { entity: "perfil", action: "update" });
  const nameId = useId();
  const emailId = useId();

  return (
    <UnsavedForm action={formAction} result={state} label="Perfil" className="space-y-5">
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


      <Button type="submit" loading={pending} loadingLabel="Salvando perfil">
        Salvar perfil
      </Button>
    </UnsavedForm>
  );
}
