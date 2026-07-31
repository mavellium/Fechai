"use client";

import { useActionState } from "react";
import { PERSONA_FIELDS, type PersonaAnswers } from "@/modules/agent-engine/persona";
import { Field, fieldProps } from "@/components/ui/field";
import { FormFeedback } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { savePersona } from "./actions";

export function PersonaForm({
  agentId,
  initial,
}: {
  agentId: string;
  initial: Partial<PersonaAnswers>;
}) {
  const [state, formAction, pending] = useActionState(savePersona, null);

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="agentId" value={agentId} />
      {PERSONA_FIELDS.map((f) => {
        // `name` já é único e estável — serve de id sem precisar de useId().
        const id = `persona-${f.name}`;
        // O schema do servidor só exige o nome do negócio; o resto é opcional.
        const required = f.name === "businessName";
        const Control = f.type === "textarea" ? Textarea : Input;

        return (
          <Field key={f.name} label={f.label} htmlFor={id} optional={!required}>
            <Control
              {...fieldProps(id)}
              name={f.name}
              placeholder={f.placeholder}
              defaultValue={initial[f.name] ?? ""}
              required={required}
            />
          </Field>
        );
      })}

      <FormFeedback error={state?.error} info={state?.info} />

      <Button type="submit" loading={pending} loadingLabel="Salvando persona">
        Salvar persona
      </Button>
    </form>
  );
}
