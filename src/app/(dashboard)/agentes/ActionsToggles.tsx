"use client";

import { useState, useTransition } from "react";
import { ArrowRight, Settings2 } from "lucide-react";
import Link from "next/link";
import { AVAILABLE_ACTIONS, type ActionKey } from "@/modules/agent-engine/actions";
import type { ScheduleConfig } from "@/modules/scheduling/config";
import { describeSchedule } from "@/modules/scheduling/config";
import type { FollowUpConfig } from "@/modules/follow-up/config";
import { describeFollowUp } from "@/modules/follow-up/config";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ScheduleSettings } from "./ScheduleSettings";
import { FollowUpSettings } from "./FollowUpSettings";
import { setActionEnabled } from "./actions";

/** Rótulo do botão que abre a configuração — uma linha por ação configurável. */
const CONFIG_LABEL: Partial<Record<ActionKey, string>> = {
  schedule_meeting: "Configurar horário de atendimento",
  follow_up: "Configurar intervalo do follow-up",
};

export function ActionsToggles({
  agentId,
  enabledKeys,
  planLimit,
  scheduleConfig,
  followUpConfig,
}: {
  agentId: string;
  enabledKeys: string[];
  planLimit: number;
  scheduleConfig: ScheduleConfig;
  followUpConfig: FollowUpConfig;
}) {
  const [enabled, setEnabled] = useState<Set<string>>(
    () => new Set(enabledKeys.filter((k) => AVAILABLE_ACTIONS.some((a) => a.key === k))),
  );
  const [error, setError] = useState<string | null>(null);
  // Guarda QUAL ação está salvando: antes um `pending` global desabilitava as
  // cinco linhas de uma vez, e nada indicava qual delas estava em voo.
  const [busyKey, setBusyKey] = useState<ActionKey | null>(null);
  // Configuração aberta manualmente. Ligar a ação também abre (ver `toggle`):
  // é o momento em que a pessoa precisa dizer o horário de atendimento.
  const [openConfig, setOpenConfig] = useState<ActionKey | null>(null);
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
        if (next && key === "schedule_meeting") setOpenConfig(key);
      } else {
        setError(res.error ?? "Não foi possível atualizar esta ação. Tente de novo.");
      }
      setBusyKey(null);
    });
  }

  return (
    <div className="space-y-3">
      {/* O que é uma "ação", em uma frase: sem isto os cinco toggles ficavam
          sem contexto — dava para achar que eram ajustes de aparência. */}
      <Alert tone="info">
        Ações são o que o agente pode fazer <strong className="font-medium">além de responder</strong>:
        marcar na sua agenda, sinalizar um lead quente, chamar você. Ele decide sozinho a hora
        de usar cada uma que estiver ligada.
      </Alert>

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
          const showConfig = a.configurable && on && openConfig === a.key;

          return (
            <li
              key={a.key}
              className={`rounded-surface border p-4 transition-colors ${
                on ? "border-iris/50 bg-iris/10" : "border-white/10"
              }`}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-white">{a.label}</span>
                    {a.status === "stub" && <Badge tone="warn">mock</Badge>}
                  </div>
                  <p id={descId} className="mt-0.5 text-sm text-white/60">
                    {a.description}
                    {blockedByPlan && " — limite do plano atingido."}
                  </p>
                  {/* O resultado visível, só quando ligada: é a resposta para
                      "liguei, e agora, onde eu vejo isso acontecer?". */}
                  {on && a.outcome && (
                    <p className="mt-1 text-sm text-white/45">→ {a.outcome}</p>
                  )}
                </div>

                <Switch
                  checked={on}
                  onCheckedChange={(next) => toggle(a.key, next)}
                  loading={busyKey === a.key}
                  disabled={busyKey !== null || blockedByPlan}
                  label={`${a.label}: ${on ? "ativa" : "inativa"}`}
                  describedBy={descId}
                />
              </div>

              {a.configurable && on && (
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => setOpenConfig(showConfig ? null : a.key)}
                    aria-expanded={showConfig}
                    className="inline-flex items-center gap-2 rounded-control font-mono text-micro uppercase tracking-[0.15em] text-white/70 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
                  >
                    <Settings2 size={13} aria-hidden />
                    {showConfig ? "Fechar configuração" : CONFIG_LABEL[a.key]}
                  </button>
                  {!showConfig && (
                    <p className="mt-1 text-sm text-white/45">
                      {a.key === "schedule_meeting" && describeSchedule(scheduleConfig)}
                      {a.key === "follow_up" && describeFollowUp(followUpConfig)}
                    </p>
                  )}
                </div>
              )}

              {showConfig && (
                <div className="mt-4">
                  {a.key === "schedule_meeting" && (
                    <ScheduleSettings agentId={agentId} config={scheduleConfig} />
                  )}
                  {a.key === "follow_up" && (
                    <FollowUpSettings agentId={agentId} config={followUpConfig} />
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {enabled.has("schedule_meeting") && (
        <Link
          href="/agenda"
          className="inline-flex items-center gap-1.5 rounded-control font-mono text-micro uppercase tracking-[0.15em] text-signal underline underline-offset-4 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
        >
          Ver a agenda
          <ArrowRight size={13} aria-hidden />
        </Link>
      )}
    </div>
  );
}
