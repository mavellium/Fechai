"use client";

import { useMemo, useState, useTransition } from "react";
import { Copy } from "lucide-react";
import { adminReplicateAgent, type AdminAgentCopyResult } from "@/app/(admin)/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, fieldProps } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SelectMenu } from "@/components/ui/select-menu";

type Source = { id: string; tenantId: string; label: string; detail: string };
type Destination = {
  id: string;
  label: string;
  status: string;
  used: number;
  limit: number;
};

export function AdminAgentReplicator({
  sources,
  destinations,
}: {
  sources: Source[];
  destinations: Destination[];
}) {
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const firstDifferent = destinations.find((tenant) => tenant.id !== sources[0]?.tenantId);
  const [destinationId, setDestinationId] = useState(firstDifferent?.id ?? destinations[0]?.id ?? "");
  const [name, setName] = useState("");
  const [result, setResult] = useState<AdminAgentCopyResult | null>(null);
  const [pending, startTransition] = useTransition();

  const sourceOptions = useMemo(
    () => sources.map((source) => ({ value: source.id, label: source.label, badge: source.detail })),
    [sources],
  );
  const destinationOptions = useMemo(
    () =>
      destinations.map((tenant) => ({
        value: tenant.id,
        label: tenant.label,
        badge: `${tenant.used}/${tenant.limit}`,
        disabled: tenant.used >= tenant.limit,
        dot: tenant.status === "active" ? "bg-success" : "bg-warn",
      })),
    [destinations],
  );

  function replicate() {
    setResult(null);
    startTransition(async () => {
      const next = await adminReplicateAgent({
        sourceAgentId: sourceId,
        destinationTenantId: destinationId,
        name: name.trim() || undefined,
      });
      setResult(next);
      if (next.ok) setName("");
    });
  }

  return (
    <section className="rounded-surface border border-white/10 bg-white/5 p-6">
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <p id="replica-source-label" className="mb-1.5 text-sm font-medium text-white/85">
            Agente de origem
          </p>
          <SelectMenu
            label="Agente de origem"
            labelledBy="replica-source-label"
            value={sourceId}
            options={sourceOptions}
            onChange={(value) => { setSourceId(value); setResult(null); }}
          />
        </div>

        <div>
          <p id="replica-destination-label" className="mb-1.5 text-sm font-medium text-white/85">
            Empresa de destino
          </p>
          <SelectMenu
            label="Empresa de destino"
            labelledBy="replica-destination-label"
            value={destinationId}
            options={destinationOptions}
            onChange={(value) => { setDestinationId(value); setResult(null); }}
          />
          <p className="mt-1.5 text-xs text-white/50">
            O número à direita mostra agentes usados e limite do plano.
          </p>
        </div>

        <Field
          label="Nome da cópia"
          htmlFor="replica-agent-name"
          hint="Opcional. Vazio mantém o nome do agente de origem."
          optional
        >
          <Input
            {...fieldProps("replica-agent-name", { hint: true })}
            value={name}
            maxLength={60}
            placeholder="Ex: Atendimento Unidade Sul"
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
      </div>

      <Alert tone="info" className="mt-5">
        Personalidade, regras, Cérebro, comportamentos e configurações das habilidades serão
        recriados. A cópia fica desligada e não vira o agente principal da empresa.
      </Alert>
      {result?.error && <Alert tone="danger" className="mt-3">{result.error}</Alert>}
      {result?.info && <Alert tone="success" className="mt-3">{result.info}</Alert>}

      <div className="mt-5 flex justify-end">
        <Button
          type="button"
          onClick={replicate}
          loading={pending}
          loadingLabel="Replicando agente"
          disabled={!sourceId || !destinationId}
        >
          <Copy size={15} aria-hidden />
          Replicar agente
        </Button>
      </div>
    </section>
  );
}
