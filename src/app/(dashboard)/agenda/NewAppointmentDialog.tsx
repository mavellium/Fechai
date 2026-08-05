"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, fieldProps } from "@/components/ui/field";
import { FormFeedback } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createManualAppointment } from "./actions";

export type ContactOption = { id: string; label: string };

/**
 * Marcar horário à mão — o cliente que ligou em vez de escrever no WhatsApp.
 *
 * `<dialog>` nativo com `showModal()`, como o resto do produto: foco preso,
 * Esc, `inert` na página e devolução do foco ao gatilho vêm do navegador.
 */
export function NewAppointmentDialog({
  contacts,
  defaultDate,
  defaultDuration,
}: {
  contacts: ContactOption[];
  /** Dia aberto no calendário — já vem preenchido para poupar dois cliques. */
  defaultDate: string;
  defaultDuration: number;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [state, formAction, pending] = useActionState(createManualAppointment, null);

  // Fecha e atualiza a lista quando o servidor confirmou.
  useEffect(() => {
    if (state?.ok) {
      ref.current?.close();
      router.refresh();
    }
  }, [state, router]);

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => ref.current?.showModal()}>
        <CalendarPlus size={14} aria-hidden />
        Marcar horário
      </Button>

      <dialog
        ref={ref}
        aria-labelledby="novo-agendamento-title"
        className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-surface border border-white/15 bg-ink p-6 text-white backdrop:bg-ink/70"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id="novo-agendamento-title" className="font-display text-lg font-semibold">
              Marcar horário
            </h2>
            <p className="mt-1 text-sm text-white/55">
              Para quem ligou ou passou na loja. Aqui você pode marcar fora do horário de
              atendimento — o limite vale só para o agente.
            </p>
          </div>
          <button
            type="button"
            onClick={() => ref.current?.close()}
            aria-label="Fechar"
            className="shrink-0 rounded-control p-1 text-white/60 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        <form action={formAction} className="space-y-5">
          <Field label="Assunto" htmlFor="ag-title">
            <Input
              {...fieldProps("ag-title")}
              name="title"
              placeholder="Ex: Aula experimental — Marina"
              maxLength={120}
              required
            />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Data" htmlFor="ag-date">
              <Input
                {...fieldProps("ag-date")}
                type="date"
                name="date"
                defaultValue={defaultDate}
                required
              />
            </Field>
            <Field label="Hora" htmlFor="ag-time">
              <Input {...fieldProps("ag-time")} type="time" name="time" required />
            </Field>
            <Field label="Duração (min)" htmlFor="ag-duration">
              <Input
                {...fieldProps("ag-duration")}
                type="number"
                name="durationMinutes"
                min={5}
                max={480}
                step={5}
                defaultValue={defaultDuration}
                required
              />
            </Field>
            <Field label="Contato" htmlFor="ag-lead" optional>
              <Select {...fieldProps("ag-lead")} name="leadId" defaultValue="">
                <option value="">Sem contato vinculado</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label="Observações" htmlFor="ag-notes" optional>
            <Textarea
              {...fieldProps("ag-notes")}
              name="notes"
              rows={3}
              maxLength={500}
              placeholder="O que precisa estar pronto, o que foi combinado..."
            />
          </Field>

          <FormFeedback error={state?.error} />

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => ref.current?.close()}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending} loadingLabel="Marcando">
              Marcar
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
