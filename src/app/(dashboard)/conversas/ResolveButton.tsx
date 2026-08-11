"use client";

import { useState, useTransition } from "react";
import { Check, Undo2, Play } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { resolveConversation, reopenConversation, setConversationAgentPaused } from "./actions";

/**
 * Ação principal de fila do histórico.
 *
 * A prioridade é do agente pausado: quando `agentPaused` está ligado (reação/
 * emoji de parada, ou resposta manual), o único botão que faz sentido é retomar
 * a IA. Antes, um turno parado por emoji caía no "Marcar como resolvida", que só
 * limpava `needsHuman` e deixava a IA muda para sempre — beco sem saída.
 */
export function ResolveButton({
  conversationId,
  needsHuman,
  agentPaused,
}: {
  conversationId: string;
  needsHuman: boolean;
  /** Um humano respondeu manualmente e a IA está muda nesta conversa. */
  agentPaused: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run() {
    setError(null);
    start(async () => {
      const res = agentPaused
        ? await setConversationAgentPaused(conversationId, false)
        : needsHuman
          ? await resolveConversation(conversationId)
          : await reopenConversation(conversationId);
      if (!res.ok) setError(res.error ?? "Não foi possível salvar agora. Tente de novo.");
    });
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant={agentPaused ? "default" : needsHuman ? "default" : "ghost"}
        size="sm"
        className="w-full"
        onClick={run}
        loading={pending}
        loadingLabel="Salvando"
      >
        {agentPaused ? (
          <>
            <Play size={14} aria-hidden />
            Ativar agente nesta conversa
          </>
        ) : needsHuman ? (
          <>
            <Check size={14} aria-hidden />
            Marcar como resolvida
          </>
        ) : (
          <>
            <Undo2 size={14} aria-hidden />
            Devolver para a fila
          </>
        )}
      </Button>
      {agentPaused && (
        <p className="text-xs leading-relaxed text-white/50">
          O agente está pausado nesta conversa — por reação, emoji ou resposta manual. Ative-o para
          ele voltar a atender.
        </p>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  );
}
