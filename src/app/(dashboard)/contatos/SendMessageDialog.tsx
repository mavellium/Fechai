"use client";

import { useId, useRef, useState, useTransition } from "react";
import { Send, X } from "lucide-react";
import posthog from "posthog-js";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { FormFeedback } from "@/components/ui/alert";
import { sendMessageToContact } from "./actions";

const MESSAGE_LIMIT = 4096;

export type ContactRef = { id: string; name: string; phone: string; isSandbox: boolean };

/**
 * Envio manual de mensagem para o WhatsApp de um contato. Reusa a mesma server
 * action do painel — o envio real acontece pela Evolution API e a mensagem fica
 * registrada na conversa em /conversas.
 */
export function SendMessageDialog({
  contact,
  canSend,
}: {
  contact: ContactRef;
  canSend: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const textId = useId();
  const [length, setLength] = useState(0);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; error?: string; info?: string } | null>(null);

  const name = contact.name || contact.phone;

  function open() {
    setResult(null);
    ref.current?.showModal();
  }

  function send(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const text = textRef.current?.value.trim();
    if (!text || pending) return;
    setResult(null);
    start(async () => {
      const res = await sendMessageToContact(contact.id, text);
      setResult(res);
      if (res.ok) {
        posthog.capture("manual_message_sent", { channel: "whatsapp" });
        if (textRef.current) textRef.current.value = "";
      }
    });
  }

  const disabled = !canSend || contact.isSandbox || pending;
  const disabledTitle = contact.isSandbox
    ? "Contato de teste — envie para um WhatsApp real"
    : !canSend
      ? "Conecte o WhatsApp na tela WhatsApp antes de enviar"
      : undefined;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        title={disabledTitle}
        onClick={open}
      >
        <Send size={14} aria-hidden />
        Enviar mensagem
      </Button>

      <dialog
        ref={ref}
        aria-labelledby="enviar-msg-titulo"
        className="m-auto w-[min(28rem,92vw)] rounded-surface border border-white/15 bg-ink p-6 text-white backdrop:bg-ink/70"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id="enviar-msg-titulo" className="font-display text-lg font-semibold">
              Mensagem para {name}
            </h2>
            <p className="mt-1 font-mono text-micro text-white/50">{contact.phone}</p>
          </div>
          <button
            type="button"
            onClick={() => ref.current?.close()}
            aria-label="Fechar"
            className="shrink-0 rounded-control p-1 text-white/60 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        <form onSubmit={send} className="space-y-4">
          <Field label="Mensagem" htmlFor={textId}>
            <Textarea
              id={textId}
              ref={textRef}
              name="text"
              autoFocus
              maxLength={MESSAGE_LIMIT}
              placeholder="Escreva a mensagem que será enviada para o WhatsApp do contato..."
              onChange={(e) => setLength(e.target.value.length)}
            />
          </Field>
          <p className="text-right font-mono text-micro text-white/40">{length}/{MESSAGE_LIMIT}</p>

          <FormFeedback error={result?.error} info={result?.ok ? result.info : undefined} />

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => ref.current?.close()}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button type="submit" size="sm" loading={pending} loadingLabel="Enviando mensagem">
              Enviar
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
