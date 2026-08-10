"use client";

import { useState, useTransition } from "react";
import { Mic, StopCircle } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { setAgentBehavior } from "./actions";

type BehaviorKey = "listenAudio" | "stopOnEmoji";

const OPTIONS: {
  key: BehaviorKey;
  icon: typeof Mic;
  title: string;
  description: string;
}[] = [
  {
    key: "listenAudio",
    icon: Mic,
    title: "Ouvir mensagens de voz",
    description:
      "Quando um cliente mandar um áudio, o agente transcreve o que foi dito e responde como se fosse texto. Desligue para o agente ignorar áudios.",
  },
  {
    key: "stopOnEmoji",
    icon: StopCircle,
    title: "Encerrar conversa com emoji",
    description:
      "Se o cliente responder só com um emoji, o agente para de responder naquela conversa — ela sobe como “precisa de você”. Devolva em Conversas para o agente retomar.",
  },
];

/** Os dois comportamentos de conversa do agente (passo "Comportamento"). */
export function BehaviorSettings({
  agentId,
  listenAudio,
  stopOnEmoji,
}: {
  agentId: string;
  listenAudio: boolean;
  stopOnEmoji: boolean;
}) {
  const [values, setValues] = useState<Record<BehaviorKey, boolean>>({
    listenAudio,
    stopOnEmoji,
  });
  // Só a opção que está salvando trava/mostra loading — as outras continuam
  // clicáveis (mesmo padrão do ActionsToggles).
  const [busyKey, setBusyKey] = useState<BehaviorKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function toggle(key: BehaviorKey, next: boolean) {
    setError(null);
    setBusyKey(key);
    startTransition(async () => {
      const res = await setAgentBehavior(agentId, key, next);
      if (res.ok) setValues((prev) => ({ ...prev, [key]: next }));
      else setError(res.error ?? "Não foi possível salvar. Tente de novo.");
      setBusyKey(null);
    });
  }

  return (
    <div className="space-y-3">
      <Alert tone="info">
        Estes são os dois comportamentos de conversa do agente: ouvir mensagens de voz e encerrar
        quando a pessoa manda só um emoji. Os dois vêm ligados por padrão.
      </Alert>

      {error && <Alert tone="danger">{error}</Alert>}

      <ul className="space-y-2">
        {OPTIONS.map((opt) => {
          const on = values[opt.key];
          const descId = `comportamento-${opt.key}-desc`;
          return (
            <li
              key={opt.key}
              className={`rounded-surface border p-4 transition-colors ${
                on ? "border-iris/50 bg-iris/10" : "border-white/10"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    aria-hidden
                    className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-iris/20 text-white"
                  >
                    <opt.icon size={18} />
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium text-white">{opt.title}</p>
                    <p id={descId} className="mt-0.5 max-w-prose text-sm text-white/60">
                      {opt.description}
                    </p>
                  </div>
                </div>
                <Switch
                  checked={on}
                  onCheckedChange={(next) => toggle(opt.key, next)}
                  loading={busyKey === opt.key}
                  disabled={busyKey !== null}
                  label={`${opt.title}: ${on ? "ligado" : "desligado"}`}
                  describedBy={descId}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
