"use client";

import { useState, useTransition } from "react";
import { RefreshCw, Sparkles } from "lucide-react";
import posthog from "posthog-js";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { relativeTime } from "@/lib/format";
import { generateConversationSummary } from "./actions";

export type SummaryState = {
  summary: string | null;
  summaryAt: Date | null;
  /** Quantas mensagens existiam quando o resumo foi gerado. */
  summaryMsgCount: number | null;
  /** Quantas existem agora — a diferença é o que deixa o aviso honesto. */
  messageCount: number;
};

/** Espelha `MIN_MESSAGES_TO_SUMMARIZE` do servidor, que é quem de fato recusa. */
const MIN_MESSAGES = 4;

/**
 * Resumo da conversa em uma leitura — "o que o cliente quer, onde parou, o que
 * fazer agora" — para não ser preciso reler 60 mensagens antes de responder.
 *
 * O resumo fica em cache no banco, então reabrir a conversa mostra o texto
 * pronto sem gastar nada. Quando chegam mensagens novas depois dele, o
 * componente **diz que está desatualizado em vez de regerar sozinho**: regerar
 * a cada abertura gastaria tokens da cota do plano sem ninguém ter pedido, e um
 * resumo velho que se anuncia velho é mais útil do que um custo silencioso.
 */
export function ConversationSummary({
  conversationId,
  state,
}: {
  conversationId: string;
  state: SummaryState;
}) {
  const [error, setError] = useState<string | null>(null);
  // Resultado da geração desta sessão. O servidor revalida a rota, mas manter o
  // texto aqui faz ele aparecer no mesmo instante do clique.
  const [fresh, setFresh] = useState<{ text: string; at: Date } | null>(null);
  const [pending, start] = useTransition();

  const summary = fresh?.text ?? state.summary;
  const summaryAt = fresh?.at ?? state.summaryAt;
  const behind = fresh
    ? 0
    : summary && state.summaryMsgCount !== null
      ? Math.max(0, state.messageCount - state.summaryMsgCount)
      : 0;

  const tooShort = state.messageCount < MIN_MESSAGES;

  function run() {
    setError(null);
    start(async () => {
      const res = await generateConversationSummary(conversationId);
      if (!res.ok || !res.summary) {
        setError(res.error ?? "Não foi possível resumir agora. Tente de novo.");
        return;
      }
      setFresh({ text: res.summary, at: new Date() });
      posthog.capture("conversation_summarized", {
        message_count: state.messageCount,
        regenerated: Boolean(state.summary),
      });
    });
  }

  return (
    <section className="space-y-2" aria-labelledby={`resumo-${conversationId}`}>
      <div className="flex items-center justify-between gap-2">
        <h3
          id={`resumo-${conversationId}`}
          className="font-mono text-micro uppercase tracking-[0.15em] text-neutral panel:text-white/50"
        >
          Resumo
        </h3>
        {summaryAt && !pending && (
          <time
            dateTime={summaryAt.toISOString()}
            className="font-mono text-micro text-neutral panel:text-white/40"
          >
            {relativeTime(summaryAt)}
          </time>
        )}
      </div>

      {pending ? (
        // Estado de carregando com a forma do conteúdo que vem — não uma área
        // vazia que faz o painel pular quando o texto chega.
        <div className="space-y-2" aria-live="polite">
          <span className="sr-only">Resumindo a conversa…</span>
          <div className="h-3 w-4/5 animate-pulse rounded-control bg-ink/10 panel:bg-white/10" />
          <div className="h-3 w-full animate-pulse rounded-control bg-ink/10 panel:bg-white/10" />
          <div className="h-3 w-3/5 animate-pulse rounded-control bg-ink/10 panel:bg-white/10" />
        </div>
      ) : summary ? (
        <>
          <p className="whitespace-pre-line text-sm leading-relaxed text-ink/85 panel:text-white/80">
            {summary}
          </p>
          {behind > 0 && (
            <p className="text-xs leading-relaxed text-neutral panel:text-white/50">
              {behind === 1
                ? "1 mensagem nova desde este resumo."
                : `${behind} mensagens novas desde este resumo.`}
            </p>
          )}
        </>
      ) : tooShort ? (
        <p className="text-xs leading-relaxed text-neutral panel:text-white/50">
          A conversa ainda é curta — leia as mensagens ao lado. O resumo fica disponível a partir de{" "}
          {MIN_MESSAGES} mensagens.
        </p>
      ) : (
        <p className="text-xs leading-relaxed text-neutral panel:text-white/50">
          Veja em uma leitura o que o cliente quer, onde a conversa parou e qual é o próximo passo.
        </p>
      )}

      {!tooShort && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          onClick={run}
          loading={pending}
          loadingLabel="Resumindo"
        >
          {summary ? (
            <>
              <RefreshCw size={14} aria-hidden />
              {behind > 0 ? "Atualizar resumo" : "Gerar de novo"}
            </>
          ) : (
            <>
              <Sparkles size={14} aria-hidden />
              Resumir conversa
            </>
          )}
        </Button>
      )}

      {error && <Alert tone="danger">{error}</Alert>}
    </section>
  );
}
