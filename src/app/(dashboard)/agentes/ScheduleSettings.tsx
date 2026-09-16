"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import type { ScheduleConfig } from "@/modules/scheduling/config";
import { weekdayLabel } from "@/modules/scheduling/config";
import { TIMEZONES } from "@/modules/scheduling/time";
import { FormFeedback } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, fieldProps } from "@/components/ui/field";
import { InfoHint } from "@/components/ui/info-hint";
import { Input } from "@/components/ui/input";
import { SelectMenu } from "@/components/ui/select-menu";
import { Switch } from "@/components/ui/switch";
import { saveScheduleConfigAction } from "./actions";
import { UnsavedForm } from "@/components/ui/unsaved-changes";

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

/**
 * Horário de atendimento da ação "Agendar horário".
 *
 * Fica embaixo do próprio toggle, e não numa tela de configurações separada:
 * a pergunta "onde eu digo que só atendo de terça a sábado?" só aparece na
 * cabeça de quem acabou de ligar o agendamento. O que for salvo aqui vai para
 * o prompt do agente e é validado de novo na hora de marcar.
 */
export function ScheduleSettings({
  agentId,
  config,
}: {
  agentId: string;
  config: ScheduleConfig;
}) {
  const [state, formAction, pending] = useActionState(saveScheduleConfigAction, null);
  const [breaks, setBreaks] = useState(config.breaks);
  const [timezone, setTimezone] = useState(config.timezone);
  const [options, setOptions] = useState({
    allowCancellation: config.allowCancellation,
    allowRescheduling: config.allowRescheduling,
    recognizeExisting: config.recognizeExisting,
  });

  const formRef = useRef<HTMLFormElement>(null);

  /**
   * Os três switches gravam sozinhos, sem esperar o botão do rodapé.
   *
   * O resto do formulário é digitação (horário, duração, pausas), onde salvar
   * a cada tecla seria errado — mas um switch já parece salvo assim que muda
   * de lado, e o botão fica longe, depois das pausas. Quem ligava "permitir
   * cancelamento" e dava F5 via o toggle voltar para desligado, achando que o
   * produto tinha perdido a configuração. Mesmo comportamento do toggle da
   * própria ação, logo acima deste bloco.
   *
   * `requestSubmit` (e não `formAction(new FormData(...))`) de propósito: leva
   * o formulário INTEIRO no mesmo envio, então o clique no switch nunca grava
   * um horário pela metade se o campo ao lado foi editado e não salvo.
   */
  const [optionsDirty, setOptionsDirty] = useState(false);

  function saveOption(key: keyof typeof options, checked: boolean) {
    setOptions((current) => ({ ...current, [key]: checked }));
    setOptionsDirty(true);
  }

  // Envia DEPOIS do render que atualizou o input escondido — submeter dentro
  // do onChange mandaria o valor antigo, que é justamente o bug em questão.
  useEffect(() => {
    if (!optionsDirty) return;
    setOptionsDirty(false);
    formRef.current?.requestSubmit();
  }, [optionsDirty]);

  return (
    <UnsavedForm ref={formRef} result={state} label="Agendamento" onSubmit={(event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      startTransition(() => formAction(data));
    }} className="space-y-5 border-t border-white/10 pt-5">
      <input type="hidden" name="agentId" value={agentId} />
      <fieldset disabled={pending} className="min-w-0 space-y-5">
      <div className="space-y-4">
        {([
          ["allowCancellation", "Permitir cancelamento", "O agente confirma qual consulta será cancelada e espera a confirmação do cliente antes de desmarcar."],
          ["allowRescheduling", "Permitir reagendamento", "O agente troca o horário após o cliente confirmar. Se o novo horário estiver indisponível, mantém o original."],
          ["recognizeExisting", "Reconhecer consulta já marcada", "Ao receber uma confirmação ou retorno, reconhece a consulta sem reiniciar o agendamento ou oferecer novos horários."],
        ] as const).map(([key, label, description]) => (
          <div key={key} className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-white/85">{label}</p>
              <p id={`schedule-${key}`} className="mt-1 text-sm text-white/60">{description}</p>
            </div>
            <Switch checked={options[key]} onCheckedChange={(checked) => saveOption(key, checked)}
              label={label} describedBy={`schedule-${key}`} />
            <input type="hidden" name={key} value={String(options[key])} />
          </div>
        ))}
      </div>

      <fieldset className="min-w-0">
        <legend className="flex items-center gap-1.5 text-sm font-medium text-white/85">
          Dias de atendimento
          <InfoHint label="dias de atendimento">
            O agente só marca horários dentro do que estiver aqui. Fora disso, ele oferece outra
            data em vez de aceitar.
          </InfoHint>
        </legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {WEEKDAYS.map((day) => {
            const id = `workday-${day}`;
            const label = weekdayLabel(day);
            return (
              <label
                key={day}
                htmlFor={id}
                className="inline-flex cursor-pointer items-center gap-2 rounded-control border border-white/15 px-3 py-2 text-sm text-white/80 transition-colors has-[:checked]:border-iris/60 has-[:checked]:bg-iris/15 has-[:checked]:text-white"
              >
                <input
                  id={id}
                  type="checkbox"
                  name="workdays"
                  value={day}
                  defaultChecked={config.workdays.includes(day)}
                  className="h-4 w-4 accent-iris"
                />
                {label.slice(0, 3)}
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Abre às" htmlFor="schedule-start">
          <Input
            {...fieldProps("schedule-start")}
            type="time"
            name="startTime"
            defaultValue={config.startTime}
            required
          />
        </Field>

        <Field label="Fecha às" htmlFor="schedule-end">
          <Input
            {...fieldProps("schedule-end")}
            type="time"
            name="endTime"
            defaultValue={config.endTime}
            required
          />
        </Field>

        <Field
          label="Duração de cada horário"
          htmlFor="schedule-duration"
          hint="Em minutos. É o tamanho do bloco que o agente reserva."
        >
          <Input
            {...fieldProps("schedule-duration", { hint: true })}
            type="number"
            name="durationMinutes"
            min={5}
            max={480}
            step={5}
            defaultValue={config.durationMinutes}
            required
          />
        </Field>

        <Field
          label="Antecedência mínima"
          htmlFor="schedule-notice"
          hint="Em horas. Impede o agente de marcar para daqui a cinco minutos."
        >
          <Input
            {...fieldProps("schedule-notice", { hint: true })}
            type="number"
            name="minNoticeHours"
            min={0}
            max={168}
            defaultValue={config.minNoticeHours}
            required
          />
        </Field>

        <div className="space-y-2">
          <p id="schedule-tz-label" className="text-sm font-medium text-white/85">Fuso horário</p>
          <SelectMenu name="timezone" label="Fuso horário" labelledBy="schedule-tz-label"
            options={TIMEZONES.some((tz) => tz.value === timezone) ? [...TIMEZONES] : [...TIMEZONES, { value: timezone, label: timezone }]}
            value={timezone} onChange={setTimezone} />
        </div>

        <Field
          label="Local ou formato"
          htmlFor="schedule-location"
          hint="Vai na confirmação que o agente manda."
          optional
        >
          <Input
            {...fieldProps("schedule-location", { hint: true })}
            name="location"
            placeholder="Ex: no estúdio, Rua X, 100 — ou Google Meet"
            defaultValue={config.location}
            maxLength={200}
          />
        </Field>
      </div>

      <fieldset className="min-w-0 space-y-3">
        <legend className="text-sm font-medium text-white/85">Pausas durante o expediente</legend>
        <p className="text-sm text-white/60">Almoço, café ou outros intervalos. Repetem-se nos dias de atendimento e bloqueiam todo o período.</p>
        <input type="hidden" name="breaks" value={JSON.stringify(breaks)} />
        {breaks.length === 0 && <p className="text-sm text-white/50">Nenhuma pausa cadastrada.</p>}
        {breaks.map((pause, index) => (
          <div key={index} className="grid items-end gap-3 rounded-control border border-white/10 p-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
            <Field label="Nome da pausa" htmlFor={`pause-label-${index}`}>
              <Input id={`pause-label-${index}`} placeholder="Ex: almoço" maxLength={60} value={pause.label}
                onChange={(e) => setBreaks((current) => current.map((b, i) => i === index ? { ...b, label: e.target.value } : b))} />
            </Field>
            <Field label="Começa às" htmlFor={`pause-start-${index}`}>
              <Input id={`pause-start-${index}`} type="time" required value={pause.startTime}
                onChange={(e) => setBreaks((current) => current.map((b, i) => i === index ? { ...b, startTime: e.target.value } : b))} />
            </Field>
            <Field label="Termina às" htmlFor={`pause-end-${index}`}>
              <Input id={`pause-end-${index}`} type="time" required value={pause.endTime}
                onChange={(e) => setBreaks((current) => current.map((b, i) => i === index ? { ...b, endTime: e.target.value } : b))} />
            </Field>
            <Button type="button" variant="ghost" aria-label={`Remover pausa ${pause.label || index + 1}`}
              onClick={() => setBreaks((current) => current.filter((_, i) => i !== index))}>Remover</Button>
          </div>
        ))}
        <Button type="button" variant="outline" disabled={breaks.length >= 12}
          onClick={() => setBreaks((current) => [...current, { label: "", startTime: "", endTime: "" }])}>
          Adicionar pausa
        </Button>
      </fieldset>

      </fieldset>

      <FormFeedback error={state?.error} info={state?.info} />

      <Button type="submit" variant="outline" loading={pending} loadingLabel="Salvando agendamento">
        Salvar configurações de agendamento
      </Button>
    </UnsavedForm>
  );
}
