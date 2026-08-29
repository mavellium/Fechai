"use client";

import { useState, useTransition } from "react";
import { Pause, Play } from "lucide-react";
import posthog from "posthog-js";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { setConversationAgentPaused } from "./actions";

/**
 * Liga/desliga o agente NESTA conversa.
 *
 * É a resposta ao "como faço o agente voltar a responder?": a reação/emoji de
 * parada pausava a IA sem nenhum botão visível para retomá-la na mesma tela —
 * o "Marcar como resolvida" só tirava a conversa da fila e a IA continuava
 * muda. Este toggle aparece no cabeçalho do histórico e faz os dois lados: pausa
 * uma conversa que você quer atender na mão e retoma a que a reação parou.
 */
export function AgentPauseButton({
  conversationId,
  paused,
}: {
  conversationId: string;
  paused: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function toggle() {
    setError(null);
    start(async () => {
      const nextPaused = !paused;
      const res = await setConversationAgentPaused(conversationId, nextPaused);
      if (!res.ok) {
        setError(res.error ?? "Não foi possível salvar agora. Tente de novo.");
        return;
      }
      posthog.capture("conversation_agent_pause_toggled", { paused: nextPaused });
    });
  }

  return (
    <div className="space-y-1.5">
      <Button
        type="button"
        size="sm"
        variant={paused ? "default" : "ghost"}
        onClick={toggle}
        loading={pending}
        loadingLabel="Salvando"
        className="w-full"
      >
        {paused ? (
          <>
            <Play size={14} aria-hidden />
            Ativar agente nesta conversa
          </>
        ) : (
          <>
            <Pause size={14} aria-hidden />
            Pausar agente nesta conversa
          </>
        )}
      </Button>
      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  );
}
