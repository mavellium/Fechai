"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SelectMenu } from "@/components/ui/select-menu";
import { parseReminderTypes, type ScheduleConfig } from "@/modules/scheduling/config";

type TypesResult = { ok: true; names: string[] } | { ok: false; error: string };

/** A seleção não altera durações nem liga os lembretes antes de salvar. */
export function ReminderAudienceSettings({
  idPrefix,
  audience,
  types,
  availableTypes,
  onAudienceChange,
  onTypesChange,
  loadTypes,
  disabled = false,
}: {
  idPrefix: string;
  audience: ScheduleConfig["reminderAudience"];
  types: string[];
  availableTypes: string[];
  onAudienceChange: (audience: ScheduleConfig["reminderAudience"]) => void;
  onTypesChange: (types: string[]) => void;
  loadTypes?: () => Promise<TypesResult>;
  disabled?: boolean;
}) {
  const [loadedTypes, setLoadedTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [newType, setNewType] = useState("");
  const autoLoadAttempted = useRef(false);
  // Todas as origens aparecem juntas e em ordem alfabética, inclusive no celular.
  const options = parseReminderTypes([...types, ...loadedTypes, ...availableTypes])
    .sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));

  const loadFromClinicorp = useCallback(async () => {
    if (!loadTypes) return;
    setLoading(true);
    setNotice(null);
    try {
      const result = await loadTypes();
      if (!result.ok) { setNotice(result.error); return; }
      setLoadedTypes(result.names);
      setNotice("Tipos carregados. Marque quais consultas devem receber lembrete.");
    } catch {
      setNotice("Não foi possível carregar os tipos do Clinicorp. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }, [loadTypes]);

  useEffect(() => {
    if (audience !== "selected_types" || !loadTypes || autoLoadAttempted.current) return;
    autoLoadAttempted.current = true;
    void loadFromClinicorp();
  }, [audience, loadTypes, loadFromClinicorp]);

  function addType() {
    const next = parseReminderTypes([...types, newType]);
    if (!newType.trim()) return;
    onTypesChange(next);
    setNewType("");
  }

  return (
    <div className="mb-5 space-y-3">
      <Field label="Quais consultas recebem lembrete?" htmlFor={`${idPrefix}-audience`} labelId={`${idPrefix}-audience-label`}>
        <SelectMenu
          label="Quais consultas recebem lembrete?"
          labelledBy={`${idPrefix}-audience-label`}
          value={audience}
          onChange={(value) => onAudienceChange(value as ScheduleConfig["reminderAudience"])}
          disabled={disabled}
          options={[
            { value: "all", label: "Todos os tipos de consulta" },
            { value: "selected_types", label: "Somente os tipos escolhidos" },
          ]}
        />
      </Field>
      {audience === "selected_types" && (
        <div className="space-y-3">
          {loadTypes && (
            <Button type="button" variant="outline" size="sm" onClick={loadFromClinicorp}
              loading={loading} loadingLabel="Carregando tipos do Clinicorp" disabled={disabled}>
              <Download size={14} aria-hidden /> Atualizar tipos do Clinicorp
            </Button>
          )}
          {notice && <p role="status" className="text-sm text-white/60">{notice}</p>}
          <Field label="Tipos que recebem lembrete" htmlFor={`${idPrefix}-types`} labelId={`${idPrefix}-types-label`}>
            <SelectMenu
              multiple
              label="Tipos que recebem lembrete"
              labelledBy={`${idPrefix}-types-label`}
              value={types}
              onChange={onTypesChange}
              disabled={disabled || loading || options.length === 0}
              placeholder="Escolha um ou mais tipos"
              options={options.map((type) => ({ value: type, label: type }))}
            />
          </Field>
          {types.length > 0 && <p className="text-sm text-white/85">Selecionados: {types.join(", ")}</p>}
          <Field label="Adicionar outro tipo" htmlFor={`${idPrefix}-new-type`} hint="Use o mesmo nome cadastrado na agenda ou na categoria do Clinicorp.">
            <div className="flex flex-wrap items-center gap-2">
              <Input id={`${idPrefix}-new-type`} value={newType} maxLength={60} placeholder="Ex.: Avaliação"
                aria-describedby={`${idPrefix}-new-type-hint`} disabled={disabled} className="min-w-0 flex-1"
                onChange={(event) => setNewType(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addType(); } }} />
              <Button type="button" variant="outline" onClick={addType} disabled={disabled || !newType.trim()}>
                <Plus size={14} aria-hidden /> Adicionar tipo
              </Button>
            </div>
          </Field>
          <p className="text-sm text-white/60">
            Somente os tipos selecionados recebem os lembretes, inclusive nas consultas marcadas
            direto no Clinicorp e nas que têm lembretes próprios. Consultas sem tipo identificado ficam de fora.
          </p>
        </div>
      )}
    </div>
  );
}
