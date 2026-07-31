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
}: {
  conversationId: string;
  needsHuman: boolean;
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
        ) : (
          <>
            <Undo2 size={14} aria-hidden />
            Devolver para a fila
          </>
        )}
      </Button>
      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  );
}
