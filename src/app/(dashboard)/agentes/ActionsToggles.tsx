"use client";

import { useState, useTransition } from "react";
import { AVAILABLE_ACTIONS, type ActionKey } from "@/modules/agent-engine/actions";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { setActionEnabled } from "./actions";

export function ActionsToggles({
  agentId,
  enabledKeys,
  planLimit,
}: {
  agentId: string;
  enabledKeys: string[];
  planLimit: number;
}) {
  const [enabled, setEnabled] = useState<Set<string>>(
    () => new Set(enabledKeys.filter((k) => AVAILABLE_ACTIONS.some((a) => a.key === k))),
  );
  const [error, setError] = useState<string | null>(null);
  // Guarda QUAL ação está salvando: antes um `pending` global desabilitava as
  // cinco linhas de uma vez, e nada indicava qual delas estava em voo.
  const [busyKey, setBusyKey] = useState<ActionKey | null>(null);
  const [, startTransition] = useTransition();

  const atLimit = enabled.size >= planLimit;

  function toggle(key: ActionKey, next: boolean) {
    setError(null);
    setBusyKey(key);
    startTransition(async () => {
      const res = await setActionEnabled(agentId, key, next);
      if (res.ok) {
        setEnabled((prev) => {
          const copy = new Set(prev);
          if (next) copy.add(key);
          else copy.delete(key);
          return copy;
        });
      } else {
        setError(res.error ?? "Não foi possível atualizar esta ação. Tente de novo.");
      }
      setBusyKey(null);
    });
  }

  return (
    <div className="space-y-3">
      <p className="font-mono text-micro uppercase tracking-[0.15em] text-white/60">
        {enabled.size}/{planLimit} ações ativas no seu plano
      </p>

      {error && <Alert tone="danger">{error}</Alert>}

      {atLimit && (
        <Alert tone="info">
          Você atingiu o limite do seu plano. Desligue uma ação para poder ligar outra.
        </Alert>
      )}

      <ul className="space-y-2">
        {AVAILABLE_ACTIONS.map((a) => {
          const on = enabled.has(a.key);
          // Bloqueia antes da ida ao servidor em vez de deixar o usuário
          // clicar e só então receber "seu plano permite N ações".
          const blockedByPlan = !on && atLimit;
          const descId = `acao-${a.key}-desc`;

          return (
            <li
              key={a.key}
              className={`flex items-center justify-between gap-4 rounded-surface border p-4 transition-colors ${
                on ? "border-iris/50 bg-iris/10" : "border-white/10"
              }`}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-white">{a.label}</span>
                  {a.status === "stub" && <Badge tone="warn">mock</Badge>}
                </div>
                <p id={descId} className="mt-0.5 text-sm text-white/60">
                  {a.description}
                  {blockedByPlan && " — limite do plano atingido."}
                </p>
              </div>

              <Switch
                checked={on}
                onCheckedChange={(next) => toggle(a.key, next)}
                loading={busyKey === a.key}
                disabled={busyKey !== null || blockedByPlan}
                label={`${a.label}: ${on ? "ativa" : "inativa"}`}
                describedBy={descId}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
