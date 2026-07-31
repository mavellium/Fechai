"use client";

import { useActionState, useId, useState } from "react";
import { Star } from "lucide-react";
import { FormFeedback } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, fieldProps } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { submitFeedback } from "./actions";

export function FeedbackForm() {
  const [state, formAction, pending] = useActionState(submitFeedback, null);
  const [rating, setRating] = useState(0);
  const messageId = useId();

  return (
    <form action={formAction} className="space-y-5">
      {/*
        Antes eram cinco <button> com aria-label, fora de qualquer grupo: o
        leitor de tela não anunciava a nota escolhida e o teclado passava por
        cinco paradas sem saber que era um valor só. Radios nativos dentro de um
        fieldset resolvem os dois — inclusive setas do teclado.
      */}
      <fieldset>
        <legend className="text-sm font-medium text-white/85">
          Sua nota <span className="font-normal text-white/55">(opcional)</span>
        </legend>
        <div className="mt-2 flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className="cursor-pointer p-1">
              <input
                type="radio"
                name="rating"
                value={n}
                checked={rating === n}
                onChange={() => setRating(n)}
                className="peer sr-only"
              />
              <span className="block rounded-sm peer-focus-visible:ring-2 peer-focus-visible:ring-iris peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-ink">
                <Star
                  size={24}
                  aria-hidden
                  className={n <= rating ? "fill-warn text-warn" : "text-white/35"}
                />
              </span>
              <span className="sr-only">
                {n} {n === 1 ? "estrela" : "estrelas"}
              </span>
            </label>
          ))}

          {rating > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-2"
              onClick={() => setRating(0)}
            >
              Limpar nota
            </Button>
          )}
        </div>
      </fieldset>

      <Field label="Mensagem" htmlFor={messageId} error={state?.error}>
        <Textarea
          {...fieldProps(messageId, { error: state?.error })}
          name="message"
          rows={4}
          placeholder="O que podemos melhorar?"
          required
        />
      </Field>

      <FormFeedback info={state?.info} />

      <Button type="submit" loading={pending} loadingLabel="Enviando feedback">
        Enviar feedback
      </Button>
    </form>
  );
}
