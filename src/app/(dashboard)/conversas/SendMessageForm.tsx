"use client";

import { useActionState, useEffect, useRef } from "react";
import { Send } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sendManualMessage } from "./actions";

type Result = { ok: boolean; error?: string };

async function action(_prev: Result | null, formData: FormData): Promise<Result> {
  const conversationId = String(formData.get("conversationId") ?? "");
  const text = String(formData.get("text") ?? "");
  return sendManualMessage(conversationId, text);
}

/**
 * Responder manualmente pelo painel — em vez de esperar o agente ou sair para
 * o WhatsApp. Numa conversa real a mensagem sai de verdade para o cliente; no
 * sandbox fica só na simulação. `sendManualMessage` decide qual dos dois, com
 * base em `Conversation.isTest` — este formulário é o mesmo nos dois casos.
 */
export function SendMessageForm({ conversationId }: { conversationId: string }) {
  const [state, formAction, pending] = useActionState<Result | null, FormData>(action, null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <div className="border-t border-white/10 p-3">
      {state?.error && (
        <Alert tone="danger" className="mb-2">
          {state.error}
        </Alert>
      )}
      <form ref={formRef} action={formAction} className="flex gap-2">
        <input type="hidden" name="conversationId" value={conversationId} />
        <label htmlFor="manual-message" className="sr-only">
          Responder manualmente
        </label>
        <Input
          id="manual-message"
          name="text"
          placeholder="Escreva sua resposta..."
          autoComplete="off"
          required
          disabled={pending}
        />
        <Button type="submit" size="icon" loading={pending} aria-label="Enviar mensagem">
          <Send size={16} aria-hidden />
        </Button>
      </form>
    </div>
  );
}
