"use client";

import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InfoHint } from "@/components/ui/info-hint";
import { SelectMenu } from "@/components/ui/select-menu";
import { setAiCooldownMinutes } from "../../actions";

/**
 * Quanto tempo uma chave fica de molho depois de estourar a cota.
 *
 * A janela certa depende do provedor, e por isso é configurável em vez de fixa:
 * o free tier do Gemini renova por minuto, enquanto uma cota diária só volta no
 * dia seguinte — deixar uma chave de molho 5 minutos nesse caso faria o agente
 * bater na mesma parede o dia inteiro.
 *
 * Zero desliga: toda mensagem tenta a sequência inteira desde o começo.
 */
const OPTIONS = [
  { value: "0", label: "Sem quarentena", badge: "tenta sempre" },
  { value: "5", label: "5 minutos", badge: "free tier" },
  { value: "15", label: "15 minutos" },
  { value: "60", label: "1 hora" },
  { value: "360", label: "6 horas" },
  { value: "1440", label: "1 dia", badge: "cota diária" },
  { value: "10080", label: "1 semana" },
];

export function CooldownSetting({ minutes }: { minutes: number }) {
  const [value, setValue] = useState(String(minutes));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = value !== String(minutes);
  // Valor gravado fora da lista (via API, ou uma opção removida depois):
  // vira uma entrada própria em vez de o menu mostrar outra coisa.
  const options = OPTIONS.some((o) => o.value === String(minutes))
    ? OPTIONS
    : [...OPTIONS, { value: String(minutes), label: `${minutes} minutos` }];

  function save() {
    setError(null);
    start(async () => {
      const r = await setAiCooldownMinutes(Number(value));
      if (r.ok) setSaved(true);
      else setError(r.error ?? "Não foi possível salvar.");
    });
  }

  return (
    <section>
      <h2 className="font-display mb-1 flex items-center gap-1.5 text-lg font-semibold text-white">
        Quarentena após falha
        <InfoHint label="quarentena após falha">
          Quando uma chave estoura a cota, ela fica de molho por este tempo e a próxima da sequência
          assume — sem isso, cada mensagem pagaria a latência do mesmo erro antes de seguir. Escolha
          pela janela do provedor: free tier costuma renovar por minuto; cota diária, só no dia
          seguinte. Chave inválida não entra em quarentena, porque não melhora com o tempo.
        </InfoHint>
      </h2>

      <div className="flex flex-wrap items-center gap-2">
        <SelectMenu
          label="Tempo de quarentena"
          value={value}
          onChange={(v) => {
            setSaved(false);
            setValue(v);
          }}
          className="w-56"
          options={options}
        />
        {dirty && (
          <>
            <Button size="sm" onClick={save} loading={pending} loadingLabel="Salvando">
              Salvar
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => setValue(String(minutes))}
            >
              Desfazer
            </Button>
          </>
        )}
        {saved && !dirty && <Badge tone="success">salvo</Badge>}
      </div>

      {error && (
        <Alert tone="danger" className="mt-3">
          {error}
        </Alert>
      )}
    </section>
  );
}
