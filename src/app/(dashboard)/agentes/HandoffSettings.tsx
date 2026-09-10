"use client";

import { useActionState, useId, useState } from "react";
import type { HandoffConfig } from "@/modules/agent-engine/handoff";
import { FormFeedback } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, fieldProps } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { saveHandoffConfigAction } from "./actions";

/**
 * Config da ação "Transferir para humano".
 *
 * Fica embaixo do próprio toggle, como o intervalo do follow-up: a pergunta
 * "colocar no grupo de qual atendimento?" só faz sentido pra quem acabou de
 * ligar a transferência.
 */
export function HandoffSettings({ agentId, config }: { agentId: string; config: HandoffConfig }) {
  const [state, formAction, pending] = useActionState(saveHandoffConfigAction, null);
  const [addToGroup, setAddToGroup] = useState(config.addToGroup);
  const groupFieldId = useId();

  return (
    <form action={formAction} className="space-y-5 border-t border-white/10 pt-5">
      <input type="hidden" name="agentId" value={agentId} />

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-white/85">Adicionar a um grupo do WhatsApp</p>
          <p id="handoff-group-desc" className="mt-0.5 text-sm text-white/60">
            Ao transferir, o número do contato entra automaticamente no grupo abaixo — a equipe
            já vê a conversa chegando lá, sem precisar salvar o contato à mão.
          </p>
        </div>
        {/* O switch controla só o campo aparecer/desaparecer; quem trava o
            envio de "ligado sem grupo" é o servidor (mesma regra de
            `parseHandoffConfig`: sem groupId, addToGroup nunca fica true). */}
        <Switch
          checked={addToGroup}
          onCheckedChange={setAddToGroup}
          label={`Adicionar a um grupo do WhatsApp: ${addToGroup ? "ligado" : "desligado"}`}
          describedBy="handoff-group-desc"
        />
      </div>
      <input type="hidden" name="addToGroup" value={addToGroup ? "on" : ""} />

      {/* O campo é ESCONDIDO, não desmontado, quando a opção está desligada: o
          `groupId` continua no envio e o ID cadastrado sobrevive a um
          desligar/ligar. Desmontando, salvar com a opção off apagava o grupo, e
          religar exigia ir buscar o ID no WhatsApp de novo — desligar é pausar,
          não descadastrar (mesma distinção de desabilitar × desconectar em
          /integracoes). */}
      <div hidden={!addToGroup}>
        <Field
          label="ID do grupo"
          htmlFor={groupFieldId}
          hint="No WhatsApp: abra o grupo › Dados do grupo › ⋮ › Copiar ID do grupo (termina em @g.us)."
        >
          <Input
            {...fieldProps(groupFieldId, { hint: true })}
            name="groupId"
            placeholder="120363012345678901@g.us"
            autoComplete="off"
            defaultValue={config.groupId ?? ""}
            // `required` só enquanto visível: um campo obrigatório escondido
            // trava o envio sem a pessoa ver onde é o erro.
            required={addToGroup}
          />
        </Field>
      </div>

      <FormFeedback error={state?.error} info={state?.info} />

      <Button type="submit" variant="outline" loading={pending} loadingLabel="Salvando transferência">
        Salvar transferência
      </Button>
    </form>
  );
}
