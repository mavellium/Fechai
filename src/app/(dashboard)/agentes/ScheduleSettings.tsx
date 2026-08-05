"use client";

import { useActionState } from "react";
import { CalendarClock } from "lucide-react";
import type { ScheduleConfig } from "@/modules/scheduling/config";
import { weekdayLabel } from "@/modules/scheduling/config";
import { TIMEZONES } from "@/modules/scheduling/time";
import { FormFeedback } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, fieldProps } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { saveScheduleConfigAction } from "./actions";

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

  return (
    <form action={formAction} className="space-y-5 border-t border-white/10 pt-5">
      <input type="hidden" name="agentId" value={agentId} />

      <div className="flex items-start gap-2 text-sm text-white/65">
        <CalendarClock size={16} aria-hidden className="mt-0.5 shrink-0 text-white/40" />
        <p className="max-w-prose">
          O agente só marca horários dentro do que estiver aqui. Fora disso, ele oferece
          outra data em vez de aceitar.
        </p>
      </div>

      <fieldset className="min-w-0">
        <legend className="text-sm font-medium text-white/85">Dias de atendimento</legend>
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

        <Field label="Fuso horário" htmlFor="schedule-tz">
          <Select {...fieldProps("schedule-tz")} name="timezone" defaultValue={config.timezone}>
            {TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </Select>
        </Field>

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

      <FormFeedback error={state?.error} info={state?.info} />

      <Button type="submit" variant="outline" loading={pending} loadingLabel="Salvando horários">
        Salvar horário de atendimento
      </Button>
    </form>
  );
}
