"use client";

import { useId, useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TypingToCheck } from "@/components/ui/TypingToCheck";
import { ChatBubble } from "@/components/chat/ChatBubble";
import { ChatLog } from "@/components/chat/ChatLog";
import { EmptyState } from "@/components/ui/empty-state";
import { MessageSquare } from "lucide-react";

type Msg = { id: string; role: "user" | "assistant"; content: string; tools?: string[] };

export function Sandbox() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  async function send(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const text = inputRef.current?.value.trim();
    if (!text || pending) return;
    inputRef.current!.value = "";
    setError(null);
    // id próprio em vez do índice do array: o React deixa de reaproveitar a
    // bolha errada quando a lista cresce.
    setMessages((m) => [...m, { id: `u-${Date.now()}`, role: "user", content: text }]);
    setPending(true);
    try {
      const res = await fetch("/api/sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      if (!res.ok && !data?.reply) {
        setError(data?.error ?? "O agente não respondeu. Tente enviar de novo.");
        return;
      }
      setMessages((m) => [
        ...m,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: data.reply ?? data.error ?? "(sem resposta)",
          tools: data.toolsUsed,
        },
      ]);
    } catch {
      setError("Não conseguimos falar com o agente. Verifique sua conexão e tente de novo.");
    } finally {
      setPending(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="space-y-3">
      <ChatLog
        label="Conversa de teste com o agente"
        scrollKey={`${messages.length}-${pending}`}
        className="max-h-80 rounded-surface border border-white/10 bg-black/25 p-3"
      >
        {messages.length === 0 && !pending && (
          <EmptyState
            icon={MessageSquare}
            title="Converse com seu agente"
            description="Escreva como um cliente escreveria. O teste fica salvo como a conversa do contato “Sandbox”."
            className="py-6"
          />
        )}

        {messages.map((m) => (
          <ChatBubble
            key={m.id}
            role={m.role}
            footer={m.tools?.length ? `ações: ${m.tools.join(", ")}` : undefined}
          >
            {m.content}
          </ChatBubble>
        ))}

        {pending && (
          <div className="flex justify-start">
            <span className="inline-flex rounded-surface rounded-bl-sm bg-white px-4 py-3 text-neutral">
              <TypingToCheck state="typing" size={16} />
            </span>
          </div>
        )}
      </ChatLog>

      {error && <Alert tone="danger">{error}</Alert>}

      <form onSubmit={send} className="flex gap-2">
        <label htmlFor={inputId} className="sr-only">
          Mensagem de teste
        </label>
        <Input
          id={inputId}
          ref={inputRef}
          placeholder="Escreva como um cliente escreveria..."
          autoComplete="off"
          disabled={pending}
        />
        <Button type="submit" loading={pending} loadingLabel="Aguardando o agente">
          Enviar
        </Button>
      </form>
    </div>
  );
}
