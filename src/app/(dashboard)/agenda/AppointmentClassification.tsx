"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Tags } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormFeedback } from "@/components/ui/alert";
import { Field, fieldProps } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { SelectMenu } from "@/components/ui/select-menu";
import { useSaveFeedback } from "@/components/ui/toast/use-save-feedback";
import { APPOINTMENT_KINDS, KIND_LABELS, type AppointmentKind } from "@/modules/scheduling/dimensions";
import { setClassificationAction } from "./actions";

/** Opção vazia explícita: o `SelectMenu` cai na primeira opção sem ela. */
export const KIND_OPTIONS = [
  { value: "", label: "Não classificado" },
  ...APPOINTMENT_KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] })),
];

/**
 * Tipo (avaliação, retorno, procedimento) e procedimento de interesse, que são
 * perguntas diferentes: "avaliação para implante" é tipo avaliação,
 * procedimento implante. Aqui a clínica corrige ou completa o que o agente não
 * registrou — o sistema nunca deduz nenhum dos dois.
 *
 * Formulário em modal: mantém o `FormFeedback` inline além do toast (o
 * `<dialog>` deixa o toast inalcançável — ver TOASTS.md).
 */
export function AppointmentClassification({
  id,
  title,
  kind,
  procedure,
}: {
  id: string;
  title: string;
  kind: AppointmentKind | null;
  procedure: string | null;
}) {
  const router = useRouter();
  const labelId = useId();
  const [open, setOpen] = useState(false);
  const [draftKind, setDraftKind] = useState<string>(kind ?? "");
  const [draftProcedure, setDraftProcedure] = useState(procedure ?? "");
  const [error, setError] = useState<string | null>(null);
  const save = useSaveFeedback({ entity: "classificação", gender: "f" });

  async function submit() {
    setError(null);
    const res = await save.run(() => setClassificationAction(id, { kind: draftKind, procedure: draftProcedure }));
    if (!res.ok) {
      setError(typeof res.error === "string" ? res.error : "Não foi possível salvar.");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => {
        setDraftKind(kind ?? "");
        setDraftProcedure(procedure ?? "");
        setError(null);
        setOpen(true);
      }}>
        <Tags size={14} aria-hidden />
        Classificar
      </Button>

      <Modal
        open={open}
        onClose={() => { if (!save.saving) setOpen(false); }}
        title={`Classificar — ${title}`}
        description="Tipo e procedimento são registrados separados. Deixe em branco o que não foi informado."
      >
        <fieldset disabled={save.saving} className="min-w-0 space-y-4">
          <div>
            <p id={labelId} className="mb-1.5 text-sm font-medium text-white/80">Tipo</p>
            <SelectMenu
              options={KIND_OPTIONS}
              value={draftKind}
              onChange={setDraftKind}
              label="Tipo do agendamento"
              labelledBy={labelId}
            />
          </div>
          <Field label="Procedimento" htmlFor={`proc-${id}`} optional hint="Ex.: implante, clareamento, limpeza.">
            <Input
              {...fieldProps(`proc-${id}`, { hint: true })}
              value={draftProcedure}
              onChange={(e) => setDraftProcedure(e.target.value)}
              maxLength={120}
            />
          </Field>

          <FormFeedback error={error} />

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Fechar
            </Button>
            <Button type="button" loading={save.saving} loadingLabel="Salvando" onClick={submit}>
              Salvar
            </Button>
          </div>
        </fieldset>
      </Modal>
    </>
  );
}
