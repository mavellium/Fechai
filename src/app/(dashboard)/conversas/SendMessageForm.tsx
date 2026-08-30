"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Send } from "lucide-react";
import posthog from "posthog-js";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn } from "@/lib/utils";
import { sendManualMessage, sendTestClientMessage } from "./actions";

type Result = { ok: boolean; error?: string; status?: string };

/** De que lado a mensagem entra: "você" (resposta manual) ou o cliente. */
type Sender = "human" | "client";

async function action(_prev: Result | null, formData: FormData): Promise<Result> {
  const conversationId = String(formData.get("conversationId") ?? "");
  const text = String(formData.get("text") ?? "");
  return formData.get("sender") === "client"
    ? sendTestClientMessage(conversationId, text)
    : sendManualMessage(conversationId, text);
}

/**
 * O que dizer quando o agente recebeu a mensagem de teste e ficou calado. Sem
 * isso, escrever como cliente e não ver resposta parecia bug — cada um destes
 * é comportamento correto, com uma causa diferente.
 */
const SILENT_STATUS: Record<string, string> = {
  human_handling:
    "O agente está pausado nesta conversa — por isso ele não respondeu. Ative-o no botão acima para testar a resposta automática.",
  agent_off:
    "O agente está desligado. Ligue a chave na página do agente para ele voltar a responder.",
  no_agent: "Esta conta ainda não tem um agente configurado para responder.",
  limit_reached: "A cota de mensagens do mês acabou.",
};

/**
 * Responder manualmente pelo painel — em vez de esperar o agente ou sair para
 * o WhatsApp. Numa conversa real a mensagem sai de verdade para o cliente; no
 * sandbox fica só na simulação. `sendManualMessage` decide qual dos dois, com
 * base em `Conversation.isTest`.
 *
 * Em conversa de TESTE aparece também o seletor de lado: dá para escrever
 * como o **cliente** e ver o agente responder de verdade, sem sair para o
 * diálogo "Testar agente" — que sempre começa do zero e perde o histórico da
 * conversa aberta. Numa conversa real esse seletor não existe: forjar uma
 * mensagem "do cliente" que ele nunca mandou envenenaria o histórico e os
 * relatórios.
 */
export function SendMessageForm({
  conversationId,
  isTest = false,
  agentPaused = false,
}: {
  conversationId: string;
  isTest?: boolean;
  /** Só usado no aviso: como cliente, o agente calado tem explicação. */
  agentPaused?: boolean;
}) {
  const [state, formAction, pending] = useActionState<Result | null, FormData>(action, null);
  const [sender, setSender] = useState<Sender>("human");
  const [showSender, setShowSender] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const senderPanelId = useId();

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  const asClient = isTest && sender === "client";
  const silent = state?.ok && state.status && state.status !== "ok" ? state.status : null;

  return (
    <div className="border-t border-white/10 p-3">
      {state?.error && (
        <Alert tone="danger" className="mb-2">
          {state.error}
        </Alert>
      )}

      {silent && (
        <Alert tone="warn" className="mb-2">
          {SILENT_STATUS[silent] ?? "O agente não respondeu desta vez."}
        </Alert>
      )}

      {isTest && (
        // Recolhido por padrão: quem já sabe de que lado está escrevendo não
        // precisa da explicação ocupando duas linhas acima do campo a cada
        // mensagem. Fechado, o lado atual continua visível no próprio botão —
        // esconder o controle não pode esconder o estado.
        <div className="mb-2">
          <button
            type="button"
            onClick={() => setShowSender((v) => !v)}
            aria-expanded={showSender}
            aria-controls={senderPanelId}
            className="flex items-center gap-1.5 rounded-control py-0.5 font-mono text-micro uppercase tracking-[0.15em] text-neutral transition-colors hover:text-ink panel:text-white/50 panel:hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
          >
            <ChevronDown
              size={12}
              aria-hidden
              className={cn("transition-transform", showSender && "rotate-180")}
            />
            Enviando como{" "}
            <span className="text-ink panel:text-white">{asClient ? "cliente" : "você"}</span>
          </button>

          {showSender && (
            <div id={senderPanelId} className="mt-2 flex flex-wrap items-center gap-2">
              <SegmentedControl<Sender>
                label="Enviar como"
                value={sender}
                options={[
                  { value: "human", label: "você" },
                  { value: "client", label: "cliente" },
                ]}
                onSelect={setSender}
                disabled={pending}
              />
              <p className="text-xs leading-relaxed text-white/50">
                {asClient
                  ? agentPaused
                    ? "O agente está pausado — ative-o acima para ele responder ao teste."
                    : "A mensagem entra como se fosse o cliente e o agente responde."
                  : "A mensagem entra como sua resposta e pausa o agente nesta conversa."}
              </p>
            </div>
          )}
        </div>
      )}

      <form
        ref={formRef}
        action={formAction}
        className="flex gap-2"
        onSubmit={() =>
          posthog.capture(asClient ? "test_client_message_submitted" : "manual_message_submitted")
        }
      >
        <input type="hidden" name="conversationId" value={conversationId} />
        {/* O lado vai no FormData, e não numa closure: a action é uma função
            de módulo, então precisa ler a escolha do próprio envio. */}
        <input type="hidden" name="sender" value={sender} />
        <label htmlFor="manual-message" className="sr-only">
          {asClient ? "Escrever como o cliente" : "Responder manualmente"}
        </label>
        <Input
          id="manual-message"
          name="text"
          placeholder={
            asClient ? "Escreva como um cliente escreveria..." : "Escreva sua resposta..."
          }
          autoComplete="off"
          required
          disabled={pending}
        />
        <Button
          type="submit"
          size="icon"
          loading={pending}
          loadingLabel={asClient ? "Aguardando o agente" : "Enviando"}
          aria-label={asClient ? "Enviar como cliente" : "Enviar mensagem"}
        >
          <Send size={16} aria-hidden />
        </Button>
      </form>
    </div>
  );
}
