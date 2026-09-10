"use client";

import { useActionState, useId, useMemo, useState } from "react";
import {
  MAX_FOLLOWUP_DELAY_MINUTES,
  formatDelay,
  type FollowUpConfig,
} from "@/modules/follow-up/config";
import { FormFeedback } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, fieldProps } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SelectMenu } from "@/components/ui/select-menu";
import { Textarea } from "@/components/ui/textarea";
import { saveFollowUpConfigAction } from "./actions";

type Unit = "minutes" | "hours";

const UNIT_OPTIONS = [
  { value: "minutes" as const, label: "minutos" },
  { value: "hours" as const, label: "horas" },
];

/**
 * Intervalo da ação "Follow-up automático".
 *
 * Fica embaixo do próprio toggle, como o horário de atendimento do
 * agendamento: a pergunta "depois de quanto tempo ele reengaja?" só faz
 * sentido pra quem acabou de ligar o follow-up.
 *
 * O valor é guardado em minutos (`FollowUpConfig.delayMinutes`), mas nem todo
 * intervalo é natural em minutos — "3 dias de silêncio" vira "4320" e ninguém
 * bate o olho e sabe o que é. Por isso a pessoa escolhe a unidade (minutos ou
 * horas) e o campo escreve o número que faz sentido nela; a conversão para
 * minutos acontece só no envio, num campo oculto.
 */
export function FollowUpSettings({ agentId, config }: { agentId: string; config: FollowUpConfig }) {
  const [state, formAction, pending] = useActionState(saveFollowUpConfigAction, null);
  const delayId = useId();

  // Começa em horas quando o valor salvo é uma hora "redonda" (o caso comum,
  // ex.: 24h) e em minutos quando não é (ex.: 90min não é hora cheia) — assim
  // reabrir o formulário mostra o número do jeito que a pessoa mais provavelmente
  // digitou da última vez, em vez de sempre converter para minutos.
  const initialUnit: Unit = config.delayMinutes % 60 === 0 ? "hours" : "minutes";
  const [unit, setUnit] = useState<Unit>(initialUnit);
  const [amount, setAmount] = useState<number>(
    initialUnit === "hours" ? config.delayMinutes / 60 : config.delayMinutes,
  );

  const delayMinutes = useMemo(
    () => Math.round(unit === "hours" ? amount * 60 : amount),
    [unit, amount],
  );

  function changeUnit(next: Unit) {
    // Converte o número já digitado para a nova unidade em vez de zerar —
    // trocar "horas" por "minutos" com 2 no campo deveria virar 120, não voltar
    // ao padrão.
    setAmount((prev) => {
      if (next === unit || !Number.isFinite(prev)) return prev;
      // Arredonda para cima na volta para horas: o campo é `step={1}` e um 1,5
      // (90 minutos vistos em horas) é rejeitado pela validação nativa, que
      // bloqueia o envio sem dizer o motivo. Mínimo de 1 para "30 minutos" não
      // virar "0 hora".
      return next === "hours" ? Math.max(1, Math.round(prev / 60)) : Math.round(prev * 60);
    });
    setUnit(next);
  }

  return (
    <form action={formAction} className="space-y-5 border-t border-white/10 pt-5">
      <input type="hidden" name="agentId" value={agentId} />
      <input type="hidden" name="delayMinutes" value={delayMinutes} />

      <div>
        {/* `<label>` de verdade (não um `<p>`): clicar no rótulo foca o campo e
            o leitor de tela anuncia os dois juntos. O número e a unidade são
            dois controles para um valor só, então o rótulo nomeia o número e o
            menu de unidade se nomeia sozinho (`label` vira `aria-label`). */}
        <label htmlFor={delayId} className="text-sm font-medium text-ink panel:text-white/85">
          Reengajar depois de
        </label>
        <p id={`${delayId}-hint`} className="mt-1 text-sm text-neutral panel:text-white/55">
          Passado esse tempo de silêncio desde a última mensagem do agente, ele manda uma mensagem
          de reengajamento sozinho — só uma vez por conversa.
        </p>
        <div className="mt-2 flex items-end gap-2">
          <div className="w-28">
            <Input
              id={delayId}
              type="number"
              min={1}
              max={unit === "hours" ? MAX_FOLLOWUP_DELAY_MINUTES / 60 : MAX_FOLLOWUP_DELAY_MINUTES}
              step={1}
              value={Number.isFinite(amount) ? amount : ""}
              onChange={(event) => setAmount(event.target.valueAsNumber)}
              aria-describedby={`${delayId}-hint ${delayId}-resultado`}
              required
            />
          </div>
          <SelectMenu
            label="Unidade do intervalo"
            value={unit}
            onChange={(v) => changeUnit(v as Unit)}
            options={UNIT_OPTIONS}
            className="w-32"
          />
        </div>
        {/* O eco do valor final existe porque o campo mostra o número numa
            unidade e o que vale é o total: "90" em minutos é 1h30min, e ver
            isso escrito evita salvar um intervalo que não era o pretendido.
            Some com o campo vazio (`valueAsNumber` é NaN enquanto a pessoa
            apaga para digitar outro número) em vez de escrever "NaNhNaNmin". */}
        <p id={`${delayId}-resultado`} className="mt-1.5 text-sm text-neutral panel:text-white/45">
          {delayMinutes >= 1 ? `= ${formatDelay(delayMinutes)} de silêncio` : " "}
        </p>
      </div>

      <Field
        label="Mensagem"
        htmlFor={`${delayId}-message`}
        hint="O texto que o agente manda sozinho ao reengajar."
      >
        <Textarea
          {...fieldProps(`${delayId}-message`, { hint: true })}
          name="message"
          rows={3}
          maxLength={500}
          defaultValue={config.message}
          required
        />
      </Field>

      <FormFeedback error={state?.error} info={state?.info} />

      <Button type="submit" variant="outline" loading={pending} loadingLabel="Salvando follow-up">
        Salvar follow-up
      </Button>
    </form>
  );
}
