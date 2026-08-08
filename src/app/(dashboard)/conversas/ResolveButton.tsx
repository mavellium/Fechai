"use client";

import { useState, useTransition } from "react";
import { Check, Undo2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { resolveConversation, reopenConversation } from "./actions";

/**
 * Tira a conversa da fila "precisa de você" (ou devolve, se a pessoa se
 * arrependeu). Sem confirmação: é reversível num clique, e a skill manda
 * reservar diálogo de confirmação para o que é destrutivo de verdade.
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
      const res = await (needsHuman
        ? resolveConversation(conversationId)
        : reopenConversation(conversationId));
      if (!res.ok) setError(res.error ?? "Não foi possível salvar agora. Tente de novo.");
    });
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant={needsHuman ? "default" : "ghost"}
        size="sm"
        className="w-full"
        onClick={run}
        loading={pending}
        loadingLabel="Salvando"
      >
        {needsHuman ? (
          <>
            <Check size={14} aria-hidden />
            Marcar como resolvida
          </>
        ) : agentPaused ? (
          <>
            <Undo2 size={14} aria-hidden />
            Devolver para o agente
          </>
        ) : (
          <>
            <Undo2 size={14} aria-hidden />
            Devolver para a fila
          </>
        )}
      </Button>
      {agentPaused && !needsHuman && (
        <p className="text-xs leading-relaxed text-white/50">
          Você respondeu manualmente — o agente não responde mais sozinho aqui até você devolver.
        </p>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  );
}
