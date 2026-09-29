"use client";

import { useActionState, useCallback, useEffect, useId, useState, useTransition } from "react";
import { useActionToast } from "@/components/ui/toast";
import type { GroupListResult } from "@/modules/agent-engine/handoff";
import { GAP_MODES, GAP_RESPONDERS, type GapSettings } from "@/modules/knowledge-gaps/settings";
import { TIMEZONES } from "@/modules/scheduling/time";
import { Button } from "@/components/ui/button";
import { Field, Fieldset } from "@/components/ui/field";
import { RadioCards } from "@/components/ui/radio-cards";
import { SelectMenu } from "@/components/ui/select-menu";
import { Switch } from "@/components/ui/switch";
import { UnsavedForm } from "@/components/ui/unsaved-changes";
import { GroupPicker } from "../agentes/HandoffSettings";
import { loadWhatsAppGroupsAction } from "../agentes/actions";
import { saveGapSettingsAction } from "./actions";

const LOAD_FAILED: GroupListResult = { ok: false, reason: "failed", error: "Não foi possível buscar os grupos do WhatsApp agora." };
const HOURS = Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: `${String(h).padStart(2, "0")}:00` }));

/**
 * Regra do transbordo e avisos da fila. Campos de um canal desligado ficam
 * escondidos, não desmontados: desligar é pausar, e o grupo escolhido
 * sobrevive a um desligar/ligar (mesma regra da transferência).
 */
export function GapSettingsForm({ settings }: { settings: GapSettings }) {
  const [state, formAction, pending] = useActionState(saveGapSettingsAction, null);
  useActionToast(state, pending, { entity: "configuração das perguntas sem resposta", gender: "f" });
  const [mode, setMode] = useState(settings.onUnanswered);
  const [notifyEmail, setNotifyEmail] = useState(settings.notifyEmail);
  const [notifyWhatsapp, setNotifyWhatsapp] = useState(settings.notifyWhatsapp);
  const [immediate, setImmediate] = useState(settings.immediate);
  const [dailyDigest, setDailyDigest] = useState(settings.dailyDigest);
  const [digestHour, setDigestHour] = useState(String(settings.digestHour));
  const [timezone, setTimezone] = useState(settings.timezone);
  const [groupId, setGroupId] = useState(settings.groupId ?? "");
  const [groupName, setGroupName] = useState(settings.groupName ?? "");
  const [groups, setGroups] = useState<GroupListResult | null>(null);
  const [loadingGroups, startLoadingGroups] = useTransition();
  const groupFieldId = useId();
  const hourLabelId = useId();
  const zoneLabelId = useId();

  const loadGroups = useCallback(() => {
    startLoadingGroups(async () => {
      setGroups(await loadWhatsAppGroupsAction().catch(() => LOAD_FAILED));
    });
  }, []);

  useEffect(() => {
    if (notifyWhatsapp && !groups && !loadingGroups) loadGroups();
  }, [notifyWhatsapp, groups, loadingGroups, loadGroups]);

  function chooseGroup(id: string) {
    setGroupId(id);
    const fromList = groups?.ok ? groups.groups.find((g) => g.id === id)?.name : undefined;
    setGroupName(fromList ?? (id === settings.groupId ? (settings.groupName ?? "") : ""));
  }

  const responders = GAP_RESPONDERS.find((r) => r.value === settings.responders)?.label ?? "Clínica";

  return (
    <UnsavedForm action={formAction} result={state} label="Perguntas sem resposta" className="space-y-6">
      <input type="hidden" name="notifyEmail" value={notifyEmail ? "on" : ""} />
      <input type="hidden" name="notifyWhatsapp" value={notifyWhatsapp ? "on" : ""} />
      <input type="hidden" name="immediate" value={immediate ? "on" : ""} />
      <input type="hidden" name="dailyDigest" value={dailyDigest ? "on" : ""} />
      <input type="hidden" name="digestHour" value={digestHour} />
      <input type="hidden" name="timezone" value={timezone} />
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="groupName" value={groupName} />

      <Fieldset legend="Quando o agente não sabe responder" hint="Em qualquer caso ele não inventa: avisa o contato que vai confirmar com a equipe.">
        <RadioCards
          name="onUnanswered"
          columns={1}
          value={mode}
          onChange={(v) => setMode(v as typeof mode)}
          options={GAP_MODES.map((m) => ({ value: m.value, label: m.label, hint: m.hint }))}
        />
      </Fieldset>

      <Fieldset legend="Avisos para a equipe" hint={`Quem responde a fila desta conta: ${responders}. Os avisos só saem quando a clínica responde.`}>
        <div className="space-y-4">
          <ToggleRow
            label="Por e-mail"
            description="Para os e-mails de acesso desta conta."
            checked={notifyEmail}
            onChange={setNotifyEmail}
          />
          <ToggleRow
            label="Em um grupo do WhatsApp"
            description="No grupo interno da equipe. Só a pergunta e o link — nenhum dado do contato."
            checked={notifyWhatsapp}
            onChange={setNotifyWhatsapp}
          />
          <div hidden={!notifyWhatsapp}>
            <GroupPicker
              fieldId={groupFieldId}
              labelId={`${groupFieldId}-label`}
              groups={groups}
              loading={loadingGroups}
              groupId={groupId}
              savedGroupId={settings.groupId}
              savedGroupName={settings.groupName}
              required={notifyWhatsapp}
              onChoose={chooseGroup}
              onReload={loadGroups}
            />
          </div>
          <ToggleRow
            label="A cada pergunta nova"
            description="Um aviso por pergunta que ainda não estava na fila. Repetições entram só no resumo."
            checked={immediate}
            onChange={setImmediate}
          />
          <ToggleRow
            label="Resumo diário"
            description="O que está esperando resposta e as perguntas mais repetidas."
            checked={dailyDigest}
            onChange={setDailyDigest}
          />
          <div hidden={!dailyDigest} className="grid gap-4 sm:grid-cols-2">
            <Field label="Horário do resumo" htmlFor={`${hourLabelId}-f`} labelId={hourLabelId}>
              <SelectMenu label="Horário do resumo" labelledBy={hourLabelId} value={digestHour} onChange={setDigestHour} options={HOURS} />
            </Field>
            <Field label="Fuso" htmlFor={`${zoneLabelId}-f`} labelId={zoneLabelId}>
              <SelectMenu label="Fuso" labelledBy={zoneLabelId} value={timezone} onChange={setTimezone} options={TIMEZONES.map((z) => ({ value: z.value, label: z.label }))} />
            </Field>
          </div>
        </div>
      </Fieldset>

      <Button type="submit" variant="outline" loading={pending} loadingLabel="Salvando">
        Salvar regra e avisos
      </Button>
    </UnsavedForm>
  );
}

function ToggleRow({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink panel:text-white/85">{label}</p>
        <p id={id} className="mt-0.5 text-sm text-neutral panel:text-white/60">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} label={`${label}: ${checked ? "ligado" : "desligado"}`} describedBy={id} />
    </div>
  );
}
