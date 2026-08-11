"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Power, Unplug, Users } from "lucide-react";
import { FormFeedback } from "@/components/ui/alert";
import { ConfirmButton } from "@/components/ui/confirm-dialog";
import { Switch } from "@/components/ui/switch";
import { disconnectWhatsapp, setWhatsappAgentEnabled, setWhatsappIgnoreGroups } from "./actions";

/**
 * Controles do canal enquanto o número está conectado: pausar/retomar o agente
 * (o mesmo `enabled` da página de agentes), ignorar grupos e desconectar.
 * São três "desligamentos" diferentes e cada um merece seu próprio botão:
 * pausar cala o agente mantendo o WhatsApp, ignorar grupos filtra o que entra,
 * e desconectar derruba o canal inteiro.
 */
export function WhatsappControls({
  connected,
  agentName,
  agentEnabled,
  ignoreGroups,
}: {
  /** true quando o número está conectado (desconectar só faz sentido aí). */
  connected: boolean;
  agentName: string;
  agentEnabled: boolean;
  ignoreGroups: boolean;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(agentEnabled);
  const [ignore, setIgnore] = useState(ignoreGroups);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  function run(
    action: () => Promise<{ ok: boolean; error?: string; info?: string }>,
    onSuccess?: (res: { ok: boolean; error?: string; info?: string }) => void,
  ) {
    setError(null);
    setInfo(null);
    start(async () => {
      const res = await action();
      if (res.ok) {
        setInfo(res.info ?? "Pronto.");
        onSuccess?.(res);
      } else {
        setError(res.error ?? "Não foi possível completar a ação.");
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-4 border-t border-white/10 pt-6">
      <h2 className="font-display text-base font-semibold text-white">Atendimento</h2>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden
            className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
              enabled ? "bg-success/20 text-success" : "bg-danger/20 text-danger"
            }`}
          >
            <Power size={18} />
          </span>
          <div className="min-w-0">
            <p className="font-medium text-white">
              {enabled ? `${agentName} está respondendo` : `${agentName} está em silêncio`}
            </p>
            <p id="whatsapp-pause-desc" className="mt-0.5 max-w-prose text-sm text-white/65">
              {enabled
                ? "Pausar faz o agente parar de responder neste número sem desconectar o WhatsApp. As mensagens continuam chegando em Conversas."
                : "Retome para o agente voltar a responder neste número."}
            </p>
          </div>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={(next) =>
            run(() => setWhatsappAgentEnabled(next), () => setEnabled(next))
          }
          loading={pending}
          disabled={pending}
          label={`Agente ${enabled ? "ligado" : "desligado"}`}
          describedBy="whatsapp-pause-desc"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-iris/15 text-iris"
          >
            <Users size={18} />
          </span>
          <div className="min-w-0">
            <p className="font-medium text-white">
              {ignore ? "Ignorar mensagens de grupos" : "Responder em grupos"}
            </p>
            <p id="whatsapp-groups-desc" className="mt-0.5 max-w-prose text-sm text-white/65">
              {ignore
                ? "Mensagens de grupos não são respondidas nem entram em Conversas. Desligue para o agente atender também nos grupos."
                : "O agente responde também em grupos. Ligue para ele ignorar mensagens de grupo."}
            </p>
          </div>
        </div>
        <Switch
          checked={ignore}
          onCheckedChange={(next) =>
            run(() => setWhatsappIgnoreGroups(next), () => setIgnore(next))
          }
          loading={pending}
          disabled={pending}
          label={`Ignorar grupos ${ignore ? "ligado" : "desligado"}`}
          describedBy="whatsapp-groups-desc"
        />
      </div>

      {connected && (
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-4">
          <div className="flex min-w-0 items-start gap-3">
            <span
              aria-hidden
              className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-danger/15 text-danger"
            >
              <Unplug size={18} />
            </span>
            <div className="min-w-0">
              <p className="font-medium text-white">Desconectar número</p>
              <p id="whatsapp-disconnect-desc" className="mt-0.5 max-w-prose text-sm text-white/65">
                O WhatsApp sai do ar e para de receber mensagens. Para voltar, conecte o número de
                novo com um novo código.
              </p>
            </div>
          </div>
          <ConfirmButton
            variant="destructive"
            confirm={{
              title: "Desconectar o número?",
              description:
                "O WhatsApp sai do ar e para de receber mensagens. O agente volta a atender quando você conectar o número de novo.",
              confirmLabel: "Desconectar",
              tone: "danger",
            }}
            onConfirm={async () => {
              const res = await disconnectWhatsapp();
              if (res.ok) {
                setError(null);
                setInfo(res.info ?? "WhatsApp desconectado.");
                router.refresh();
              } else {
                setError(res.error ?? "Não foi possível desconectar.");
                router.refresh();
              }
            }}
            disabled={pending}
          >
            Desconectar
          </ConfirmButton>
        </div>
      )}

      <FormFeedback error={error} info={info} />
    </div>
  );
}
