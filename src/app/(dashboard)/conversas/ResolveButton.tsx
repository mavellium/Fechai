"use client";

import { Check, Undo2, Play } from "lucide-react";
import posthog from "posthog-js";
import { Button } from "@/components/ui/button";
import { useSaveFeedback } from "@/components/ui/toast/use-save-feedback";
import { resolveConversation, reopenConversation, setConversationAgentPaused } from "./actions";

/**
 * Ação principal de fila do histórico.
 *
 * Uma conversa pausada ou sem agente ativo pode ser devolvida ao atendimento
 * automático. As demais mantêm as ações da fila humana.
 */
export function ResolveButton({
  conversationId,
  needsHuman,
  agentPaused,
  agentAvailable,
}: {
  conversationId: string;
  needsHuman: boolean;
  /** Um humano respondeu manualmente e a IA está muda nesta conversa. */
  agentPaused: boolean;
  agentAvailable: boolean;
}) {
  const save = useSaveFeedback({ entity: "conversa", gender: "f" });
  const reactivate = agentPaused || !agentAvailable;

  async function run() {
    const status = reactivate ? "agent_resumed" : needsHuman ? "resolved" : "reopened";
    const res = await save.run(() =>
      reactivate
        ? setConversationAgentPaused(conversationId, false)
        : needsHuman
          ? resolveConversation(conversationId)
          : reopenConversation(conversationId),
    );
    if (res.ok) posthog.capture("conversation_status_changed", { status });
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant={reactivate ? "default" : needsHuman ? "default" : "ghost"}
        size="sm"
        className="w-full"
        onClick={run}
        loading={save.saving}
        loadingLabel="Salvando"
      >
        {reactivate ? (
          <>
            <Play size={14} aria-hidden />
            Reativar agente
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
      {reactivate && (
        <p className="text-xs leading-relaxed text-white/50">
          Se houver uma mensagem pendente, o agente tentará respondê-la agora. Depois, atenderá as próximas.
        </p>
      )}
    </div>
  );
}
