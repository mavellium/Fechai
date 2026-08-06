"use client";

import { useActionState } from "react";
import { Clock3 } from "lucide-react";
import type { FollowUpConfig } from "@/modules/follow-up/config";
import { FormFeedback } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, fieldProps } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { saveFollowUpConfigAction } from "./actions";

/**
 * Intervalo da ação "Follow-up automático".
 *
 * Fica embaixo do próprio toggle, como o horário de atendimento do
 * agendamento: a pergunta "depois de quanto tempo ele reengaja?" só faz
 * sentido pra quem acabou de ligar o follow-up.
 */
export function FollowUpSettings({ agentId, config }: { agentId: string; config: FollowUpConfig }) {
  const [state, formAction, pending] = useActionState(saveFollowUpConfigAction, null);

  return (
    <form action={formAction} className="space-y-5 border-t border-white/10 pt-5">
      <input type="hidden" name="agentId" value={agentId} />

      <div className="flex items-start gap-2 text-sm text-white/65">
        <Clock3 size={16} aria-hidden className="mt-0.5 shrink-0 text-white/40" />
        <p className="max-w-prose">
          Se o lead ficar em silêncio por esse tempo depois da última mensagem do agente, ele manda
          uma mensagem de reengajamento sozinho — só uma vez por conversa.
        </p>
      </div>

      <Field
        label="Reengajar depois de"
        htmlFor="followup-delay"
        hint="Em horas. Ex.: 24 = um dia inteiro de silêncio."
      >
        <Input
          {...fieldProps("followup-delay", { hint: true })}
          type="number"
          name="delayHours"
          min={1}
          max={720}
          defaultValue={config.delayHours}
          required
        />
      </Field>

      <Field
        label="Mensagem"
        htmlFor="followup-message"
        hint="O texto que o agente manda sozinho ao reengajar."
      >
        <Textarea
          {...fieldProps("followup-message", { hint: true })}
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
