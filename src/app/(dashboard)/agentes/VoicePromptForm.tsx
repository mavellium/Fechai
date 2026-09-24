"use client";

import { useId, useState, useTransition } from "react";
import { FormFeedback } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, fieldProps } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { saveVoicePrompt, type Result } from "./actions";

const MAX_LENGTH = 1200;

export function VoicePromptForm({ agentId, initial }: { agentId: string; initial: string }) {
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [state, setState] = useState<Result | null>(null);
  const [pending, startTransition] = useTransition();
  const inputId = useId();

  function save() {
    setState(null);
    startTransition(async () => {
      const result = await saveVoicePrompt(agentId, value);
      if (result.ok) setSaved(value.trim());
      setState(result);
    });
  }

  return (
    <div className="mt-5 border-t border-white/10 pt-5">
      <Field
        label="Instruções para a fala"
        htmlFor={inputId}
        hint="Para respostas automáticas em áudio. Oriente o jeito de dizer, sem mudar informações do atendimento."
      >
        <Textarea
          {...fieldProps(inputId, { hint: true })}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setState(null);
          }}
          maxLength={MAX_LENGTH}
          rows={3}
          placeholder="Ex.: fale de forma calma e natural. Diga datas por extenso e prefira 'meia-noite' a 'zero horas'."
          disabled={pending}
        />
      </Field>
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="text-xs text-white/50">{value.length}/{MAX_LENGTH}</span>
        <Button type="button" variant="outline" onClick={save} disabled={pending || value.trim() === saved}>
          {pending ? "Salvando..." : "Salvar instruções"}
        </Button>
      </div>
      <div className="mt-2" aria-live="polite">
        <FormFeedback error={state?.error} info={state?.ok ? state.info : undefined} />
      </div>
    </div>
  );
}
