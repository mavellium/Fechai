"use client";

import { useActionState, useId } from "react";
import { Button } from "@/components/ui/button";
import { Field, fieldProps } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useActionToast } from "@/components/ui/toast";
import { UnsavedForm } from "@/components/ui/unsaved-changes";
import { saveServiceAreaAction } from "./actions";

/**
 * Área de atendimento: a cidade da clínica e as outras que ela atende, por
 * nome. Define o que é "de fora do raio" nos relatórios de qualidade dos leads.
 * `suggestedCity` (a cidade do cadastro) só preenche o campo enquanto nada foi
 * salvo — não vale como configuração até a pessoa confirmar.
 */
export function ServiceAreaForm({ baseCity, cities, suggestedCity }: { baseCity: string | null; cities: string[]; suggestedCity: string | null }) {
  const [state, formAction, pending] = useActionState(saveServiceAreaAction, null);
  useActionToast(state, pending, { entity: "área de atendimento", gender: "f" });
  const baseId = useId();
  const citiesId = useId();

  return (
    <UnsavedForm action={formAction} result={state} label="Área de atendimento" className="space-y-5">
      <Field label="Cidade da clínica" htmlFor={baseId} hint={baseCity ? undefined : suggestedCity ? "Sugerida pelo seu cadastro — confirme e salve." : undefined}>
        <Input {...fieldProps(baseId, { hint: !baseCity && Boolean(suggestedCity) })} name="baseCity" defaultValue={baseCity ?? suggestedCity ?? ""} placeholder="Ex.: Garça" required maxLength={60} />
      </Field>

      <Field label="Outras cidades que você atende" htmlFor={citiesId} optional hint="Uma por linha. Leads de qualquer cidade fora desta lista contam como fora do raio.">
        <Textarea {...fieldProps(citiesId, { hint: true })} name="cities" defaultValue={cities.join("\n")} rows={4} placeholder={"Ex.:\nVera Cruz\nÁlvaro de Carvalho"} />
      </Field>

      <Button type="submit" loading={pending} loadingLabel="Salvando área de atendimento">
        Salvar área de atendimento
      </Button>
    </UnsavedForm>
  );
}
