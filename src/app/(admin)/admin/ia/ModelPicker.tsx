"use client";

import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import type { AiModelInfo } from "@/modules/ai/catalog";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { LoadingDots } from "@/components/ui/loading-dots";
import { changeAiModel } from "../../actions";

type Props = {
  models: (AiModelInfo & { keyConfigured: boolean })[];
  activeId: string;
};

export function ModelPicker({ models, activeId }: Props) {
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState(activeId);
  const [error, setError] = useState<string | null>(null);

  function pick(id: string) {
    if (id === selected || pending) return;
    const previous = selected;
    setSelected(id); // otimista — o servidor confirma no revalidate
    setError(null);
    start(async () => {
      try {
        await changeAiModel(id);
      } catch {
        setSelected(previous);
        setError("Não foi possível salvar. Tente de novo.");
      }
    });
  }

  return (
    <div>
      {error && (
        <Alert tone="danger" className="mb-3">
          {error}
        </Alert>
      )}

      {/*
        `role="radiogroup"` precisa ter os `role="radio"` como filhos diretos —
        com <ul>/<li> no meio a árvore de acessibilidade quebra o grupo.
      */}
      <div role="radiogroup" aria-label="Modelo de IA ativo" className="space-y-2">
        {models.map((m) => {
          const active = m.id === selected;
          return (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={pending}
              onClick={() => pick(m.id)}
              className={`w-full rounded-surface border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris focus-visible:ring-offset-2 focus-visible:ring-offset-ink ${
                active ? "border-iris/60 bg-iris/10" : "border-white/10 bg-white/5 enabled:hover:border-white/30"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-white">{m.label}</span>
                    <Badge tone={m.tier === "free" ? "success" : "warn"}>
                      {m.tier === "free" ? "gratuito" : "pago"}
                    </Badge>
                    {!m.keyConfigured && <Badge tone="danger">sem {m.envKey}</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-white/65">{m.description}</p>
                  <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 font-mono text-micro uppercase tracking-wide text-white/55">
                    <div>
                      <dt className="inline">limites · </dt>
                      <dd className="inline text-white/70">{m.limits}</dd>
                    </div>
                    <div>
                      <dt className="inline">custo /1M · </dt>
                      <dd className="inline text-white/70">{m.pricing}</dd>
                    </div>
                  </dl>
                </div>
                <span
                  aria-hidden
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                    active ? "bg-iris text-white" : "border border-white/25"
                  }`}
                >
                  {active && <Check size={12} strokeWidth={3} />}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <p
        aria-live="polite"
        className="mt-3 flex items-center gap-2 font-mono text-micro uppercase tracking-[0.15em] text-white/55"
      >
        {pending ? (
          <>
            <LoadingDots size={3} label={null} />
            salvando...
          </>
        ) : (
          "a troca vale para o próximo turno do agente (cache 30s)"
        )}
      </p>
    </div>
  );
}
