"use client";

import { useId, useRef, useState } from "react";
import { MessageSquare, RotateCcw } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TypingToCheck } from "@/components/ui/TypingToCheck";
import { ChatBubble } from "@/components/chat/ChatBubble";
import { ChatLog } from "@/components/chat/ChatLog";
import { EmptyState } from "@/components/ui/empty-state";

type Msg = { id: string; role: "user" | "assistant"; content: string; tools?: string[] };

/** Rótulos das ações no rodapé da bolha — "register_lead" não dizia nada. */
const TOOL_LABELS: Record<string, string> = {
  register_lead: "registrou o contato",
  mark_hot_lead: "marcou como lead quente",
  schedule_meeting: "marcou na agenda",
  follow_up: "programou follow-up",
  handoff_human: "chamou um humano",
};

/**
 * Chat de teste.
 *
 * Duas coisas mudaram aqui: ele agora fala com UM agente escolhido (`agentId`),
 * em vez de sempre com o principal da conta; e a conversa nasce marcada como
 * teste no banco, então não aparece em Contatos/Conversas nem conta como lead
 * nos relatórios — antes cada teste inflava os números da conta.
 */
export function Sandbox({ agentId }: { agentId?: string } = {}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [pending, setPending] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  async function send(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const text = inputRef.current?.value.trim();
    if (!text || pending) return;
    inputRef.current!.value = "";
    setError(null);
    setPaused(false);
    // id próprio em vez do índice do array: o React deixa de reaproveitar a
    // bolha errada quando a lista cresce.
    setMessages((m) => [...m, { id: `u-${Date.now()}`, role: "user", content: text }]);
    setPending(true);
    try {
      const res = await fetch("/api/sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, agentId }),
      });
      const data = await res.json();
      if (!res.ok && !data?.reply) {
        setError(data?.error ?? "O agente não respondeu. Tente enviar de novo.");
        return;
      }
      // Agente desligado (ou conta sem agente): o silêncio é o comportamento
      // correto, então a tela explica em vez de mostrar uma bolha vazia.
      if (data.status && data.status !== "ok") {
        setPaused(true);
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

  async function reset() {
    setResetting(true);
    setError(null);
    setPaused(false);
    try {
      // Apagar no servidor também: o histórico ia junto no contexto do próximo
      // turno, então limpar só a tela dava a impressão de agente com memória
      // fantasma da persona anterior.
      await fetch(`/api/sandbox${agentId ? `?agentId=${encodeURIComponent(agentId)}` : ""}`, {
        method: "DELETE",
      });
      setMessages([]);
    } catch {
      setError("Não conseguimos limpar o teste agora.");
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-micro uppercase tracking-[0.15em] text-white/45">
          conversa de teste · não vira contato
        </p>
        {messages.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={reset}
            loading={resetting}
            loadingLabel="Limpando o teste"
          >
            <RotateCcw size={14} aria-hidden />
            Recomeçar
          </Button>
        )}
      </div>

      <ChatLog
        label="Conversa de teste com o agente"
        scrollKey={`${messages.length}-${pending}`}
        className="max-h-80 rounded-surface border border-white/10 bg-black/25 p-3"
      >
        {messages.length === 0 && !pending && (
          <EmptyState
            icon={MessageSquare}
            title="Converse com seu agente"
            description="Escreva como um cliente escreveria. Este teste não conta como contato, não aparece em Conversas e não entra nos relatórios."
            className="py-6"
          />
        )}

        {messages.map((m) => (
          <ChatBubble
            key={m.id}
            role={m.role}
            footer={
              m.tools?.length
                ? `ações: ${m.tools.map((t) => TOOL_LABELS[t] ?? t).join(", ")}`
                : undefined
            }
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

      {paused && (
        <Alert tone="warn">
          O agente está desligado — por isso ele não respondeu. Ligue a chave na página do agente
          para voltar a testar.
        </Alert>
      )}

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
