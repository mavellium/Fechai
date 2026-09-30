"use client";

import { Pause, Play } from "lucide-react";
import posthog from "posthog-js";
import { Button } from "@/components/ui/button";
import { useSaveFeedback } from "@/components/ui/toast/use-save-feedback";
import { setConversationAgentPaused } from "./actions";

/**
 * Liga/desliga o agente NESTA conversa.
 *
 * O controle aparece no cabeçalho do histórico. Reativar também atribui um
 * agente ativo quando a conversa ficou sem um e limpa a prioridade pendente.
 */
export function AgentPauseButton({
  conversationId,
  paused,
  agentAvailable,
  needsHuman,
}: {
  conversationId: string;
  paused: boolean;
  agentAvailable: boolean;
  needsHuman: boolean;
}) {
  const save = useSaveFeedback({ entity: "atendimento" });
  const reactivate = paused || !agentAvailable || needsHuman;

  async function toggle() {
    const nextPaused = !reactivate;
    const res = await save.run(() => setConversationAgentPaused(conversationId, nextPaused));
    if (res.ok) posthog.capture("conversation_agent_pause_toggled", { paused: nextPaused });
  }

  return (
    <div>
      <Button
        type="button"
        size="sm"
        variant={reactivate ? "default" : "ghost"}
        onClick={toggle}
        loading={save.saving}
        loadingLabel="Salvando"
        className="w-full"
      >
        {reactivate ? (
          <>
            <Play size={14} aria-hidden />
            Reativar agente
          </>
        ) : (
          <>
            <Pause size={14} aria-hidden />
            Pausar agente nesta conversa
          </>
        )}
      </Button>
    </div>
  );
}
