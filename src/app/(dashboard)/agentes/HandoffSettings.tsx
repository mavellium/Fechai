"use client";

import { useActionState, useCallback, useEffect, useId, useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import {
  MAX_GROUP_REASON,
  type GroupListResult,
  type HandoffConfig,
} from "@/modules/agent-engine/handoff";
import { Alert, FormFeedback } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, fieldProps } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SelectMenu, type SelectMenuOption } from "@/components/ui/select-menu";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { loadWhatsAppGroupsAction, saveHandoffConfigAction } from "./actions";
import { UnsavedForm } from "@/components/ui/unsaved-changes";

const LOAD_FAILED: GroupListResult = {
  ok: false,
  reason: "failed",
  error: "Não foi possível buscar os grupos do WhatsApp agora.",
};

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
  const [groupId, setGroupId] = useState(config.groupId ?? "");
  const [groupName, setGroupName] = useState(config.groupName ?? "");
  const [groups, setGroups] = useState<GroupListResult | null>(null);
  const [loadingGroups, startLoadingGroups] = useTransition();
  const groupFieldId = useId();
  const groupLabelId = `${groupFieldId}-label`;
  const reasonFieldId = useId();

  const loadGroups = useCallback(() => {
    startLoadingGroups(async () => {
      setGroups(await loadWhatsAppGroupsAction().catch(() => LOAD_FAILED));
    });
  }, []);

  // A lista só é buscada com a opção ligada: a Evolution leva segundos numa
  // conta com muitos grupos, e quem não usa grupo não precisa esperar por ela.
  useEffect(() => {
    if (addToGroup && !groups && !loadingGroups) loadGroups();
  }, [addToGroup, groups, loadingGroups, loadGroups]);

  function chooseGroup(id: string) {
    setGroupId(id);
    const fromList = groups?.ok ? groups.groups.find((g) => g.id === id)?.name : undefined;
    setGroupName(fromList ?? (id === config.groupId ? (config.groupName ?? "") : ""));
  }

  return (
    <UnsavedForm action={formAction} result={state} label="Transferência" className="space-y-5 border-t border-white/10 pt-5">
      <input type="hidden" name="agentId" value={agentId} />
      {/* Grupo escolhido vai sempre por aqui, venha da lista ou do ID colado:
          o controle visível muda conforme a lista carregou ou não. */}
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="groupName" value={groupName} />

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

      {/* Os campos ficam ESCONDIDOS, não desmontados, quando a opção está
          desligada: grupo e motivo continuam no envio e sobrevivem a um
          desligar/ligar — desligar é pausar, não descadastrar (mesma distinção
          de desabilitar × desconectar em /integracoes). */}
      <div hidden={!addToGroup} className="space-y-5">
        <GroupPicker
          fieldId={groupFieldId}
          labelId={groupLabelId}
          groups={groups}
          loading={loadingGroups}
          groupId={groupId}
          savedGroupId={config.groupId}
          savedGroupName={config.groupName}
          required={addToGroup}
          onChoose={chooseGroup}
          onReload={loadGroups}
        />

        <Field
          label="Quando mandar para este grupo"
          htmlFor={reasonFieldId}
          optional
          hint="O agente transfere e adiciona o contato ao grupo sempre que isso acontecer. Em branco, ele decide sozinho quando transferir."
        >
          <Textarea
            {...fieldProps(reasonFieldId, { hint: true })}
            name="groupReason"
            rows={3}
            maxLength={MAX_GROUP_REASON}
            placeholder="Ex.: quando o paciente quiser fechar o orçamento ou pedir para falar com a recepção."
            defaultValue={config.groupReason}
          />
        </Field>
      </div>

      <FormFeedback error={state?.error} info={state?.info} />

      <Button type="submit" variant="outline" loading={pending} loadingLabel="Salvando transferência">
        Salvar transferência
      </Button>
    </UnsavedForm>
  );
}

/**
 * O grupo em si: lista do número conectado quando dá, ID colado quando não dá.
 *
 * A lista é conveniência, não requisito — com a Evolution fora do ar ou o
 * número desconectado, a pessoa ainda salva colando o ID. A exceção é a
 * conexão da Meta: lá não existe grupo, e oferecer o campo seria prometer algo
 * que o envio não cumpre.
 */
function GroupPicker({
  fieldId,
  labelId,
  groups,
  loading,
  groupId,
  savedGroupId,
  savedGroupName,
  required,
  onChoose,
  onReload,
}: {
  fieldId: string;
  labelId: string;
  groups: GroupListResult | null;
  loading: boolean;
  groupId: string;
  savedGroupId: string | null;
  savedGroupName: string | null;
  required: boolean;
  onChoose: (id: string) => void;
  onReload: () => void;
}) {
  const reload = (label: string) => (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      loading={loading}
      loadingLabel="Buscando grupos"
      onClick={onReload}
    >
      <RefreshCw size={14} aria-hidden />
      {label}
    </Button>
  );

  // Só a PRIMEIRA busca troca o campo por "buscando": ao atualizar, a lista
  // atual fica na tela e só o botão mostra que está carregando.
  if (!groups) {
    return (
      <Field label="Grupo" htmlFor={fieldId} labelId={labelId}>
        <SelectMenu
          label="Grupo"
          labelledBy={labelId}
          disabled
          value=""
          onChange={() => {}}
          options={[{ value: "", label: "Buscando os grupos do WhatsApp…" }]}
        />
      </Field>
    );
  }

  if (!groups.ok && groups.reason === "unsupported") {
    return <Alert tone="warn">{groups.error}</Alert>;
  }

  if (!groups.ok) {
    return (
      <div className="space-y-3">
        <Alert tone="warn">{groups.error} Você pode tentar de novo ou colar o ID do grupo.</Alert>
        {reload("Tentar de novo")}
        <Field
          label="ID do grupo"
          htmlFor={fieldId}
          hint="No WhatsApp: abra o grupo › Dados do grupo › ⋮ › Copiar ID do grupo (termina em @g.us)."
        >
          <Input
            {...fieldProps(fieldId, { hint: true })}
            placeholder="120363012345678901@g.us"
            autoComplete="off"
            value={groupId}
            onChange={(e) => onChoose(e.target.value)}
            // `required` só enquanto visível: um campo obrigatório escondido
            // trava o envio sem a pessoa ver onde é o erro.
            required={required}
          />
        </Field>
      </div>
    );
  }

  if (groups.groups.length === 0) {
    return (
      <div className="space-y-3">
        <Alert tone="info">
          Nenhum grupo encontrado no WhatsApp conectado. Crie o grupo no celular, com este número
          como administrador, e atualize a lista.
        </Alert>
        {reload("Atualizar lista")}
      </div>
    );
  }

  const options: SelectMenuOption[] = [
    // A opção vazia precisa existir: sem ela o SelectMenu mostraria o
    // primeiro grupo como escolhido, sem ninguém ter escolhido.
    { value: "", label: "Escolha um grupo" },
    ...groups.groups.map((g) => ({ value: g.id, label: g.name })),
  ];
  // O grupo salvo que sumiu da lista (o número saiu dele, ou foi colado à mão
  // antes) continua como opção: senão o menu cairia em "Escolha um grupo" e o
  // próximo salvar apagaria a escolha sem ninguém pedir.
  if (savedGroupId && !groups.groups.some((g) => g.id === savedGroupId)) {
    options.push({
      value: savedGroupId,
      label: `${savedGroupName || savedGroupId} (não encontrado no WhatsApp)`,
      separatorBefore: true,
    });
  }

  return (
    <Field
      label="Grupo"
      htmlFor={fieldId}
      labelId={labelId}
      hint="O número conectado precisa ser administrador do grupo — sem isso, o WhatsApp recusa adicionar o contato."
    >
      <div className="flex flex-wrap items-center gap-2">
        <SelectMenu
          className="min-w-0 flex-1"
          label="Grupo"
          labelledBy={labelId}
          value={groupId}
          onChange={onChoose}
          options={options}
        />
        {reload("Atualizar lista")}
      </div>
    </Field>
  );
}
