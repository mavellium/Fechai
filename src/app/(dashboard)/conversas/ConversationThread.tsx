import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ChatBubble } from "@/components/chat/ChatBubble";
import { ChatLog } from "@/components/chat/ChatLog";
import { dayLabel, phoneLabel, relativeTime, timeLabel } from "@/lib/format";
import { leadStatusLabel } from "./leadStatus";
import { LeadPanel, type LeadPanelData } from "./LeadPanel";
import { SendMessageForm } from "./SendMessageForm";
import { DeleteTestConversationButton } from "./DeleteTestConversationButton";
import { AgentPauseButton } from "./AgentPauseButton";

type ThreadMessage = {
  id: string;
  role: string;
  content: string;
  createdAt: Date;
  sentBy: string | null;
};

/**
 * Histórico da conversa: cabeçalho fixo + mensagens com scroll próprio.
 *
 * O cabeçalho ficava dentro do fluxo da página: numa conversa longa, rolar até
 * o fim tirava da tela justamente a informação de com quem se está falando.
 * Aqui ele é irmão da área rolável, então nunca sai de vista.
 */
export function ConversationThread({
  conversation,
  messages,
  backHref,
}: {
  conversation: LeadPanelData;
  messages: ThreadMessage[];
  /** Volta para a lista no celular, onde só um painel aparece por vez. */
  backHref: string;
}) {
  const status = leadStatusLabel(conversation.lead.status);
  const name = conversation.lead.name ?? "Cliente sem nome";

  // Quem escreveu cada mensagem: o lead ("user"), a IA ("assistant" de
  // "agent") ou o dono da conta respondendo à mão ("assistant" de "human").
  function senderLabel(m: ThreadMessage) {
    if (m.role === "user") return conversation.lead.name ?? "cliente";
    return m.sentBy === "human" ? "você" : "agente";
  }

  return (
    <>
      <header className="flex flex-wrap items-center gap-3 border-b border-white/10 p-4">
        <Link
          href={backHref}
          aria-label="Voltar para a lista de conversas"
          className="-ml-1 rounded-control p-1 text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris lg:hidden"
        >
          <ArrowLeft size={18} aria-hidden />
        </Link>

        <div className="min-w-0 flex-1">
          <h2 className="font-display truncate text-base font-semibold text-white">{name}</h2>
          <p className="truncate font-mono text-micro text-white/50">
            {phoneLabel(conversation.lead.phone)} · {relativeTime(conversation.updatedAt)}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {conversation.isTest ? (
            <Badge tone="neutral">teste</Badge>
          ) : (
            <Badge tone={status.tone}>{status.label}</Badge>
          )}
          {conversation.needsHuman && <Badge tone="danger">precisa de você</Badge>}
          {conversation.isTest && (
            <DeleteTestConversationButton conversationId={conversation.id} />
          )}
        </div>
      </header>

      <div className="border-b border-white/10 px-4 py-2">
        <AgentPauseButton
          conversationId={conversation.id}
          paused={conversation.agentPaused}
        />
      </div>

      {/* Abaixo de xl não há terceira coluna: o contexto do lead vira um bloco
          que a pessoa abre quando precisa, em vez de sumir da tela. */}
      <details className="border-b border-white/10 xl:hidden">
        <summary className="cursor-pointer px-4 py-2 font-mono text-micro uppercase tracking-[0.15em] text-white/50 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris">
          Dados do cliente e ações
        </summary>
        <div className="px-4 pb-4">
          <LeadPanel conversation={conversation} />
        </div>
      </details>

      <ChatLog
        label={`Histórico da conversa com ${name}`}
        scrollKey={conversation.id}
        className="flex-1 space-y-0 p-4"
      >
        {messages.map((m, i) => {
          const previous = messages[i - 1];
          const newDay =
            !previous ||
            previous.createdAt.toDateString() !== m.createdAt.toDateString();
          // Mensagens seguidas do mesmo lado ficam coladas: numa conversa de 40
          // mensagens, o espaçamento uniforme vira ruído e esconde os turnos.
          const sameSpeaker = previous?.role === m.role && !newDay;

          return (
            <div key={m.id}>
              {newDay && (
                <p className="my-4 text-center font-mono text-micro uppercase tracking-[0.15em] text-white/35">
                  {dayLabel(m.createdAt)}
                </p>
              )}
              <div className={sameSpeaker ? "mt-1" : newDay ? "" : "mt-4"}>
                <ChatBubble
                  role={m.role === "user" ? "user" : "assistant"}
                  footer={`${senderLabel(m)} · ${timeLabel(m.createdAt)}`}
                >
                  {m.content}
                </ChatBubble>
              </div>
            </div>
          );
        })}
      </ChatLog>

      {conversation.needsHuman && (
        <div className="border-t border-white/10 bg-warn/5 px-4 py-3">
          {conversation.agentPaused ? (
            <p className="text-sm text-white/80">
              O agente está pausado nesta conversa (por reação, emoji ou você) — por isso ele não
              respondeu. Ative-o acima para ele voltar a atender, ou responda você mesmo.
            </p>
          ) : (
            <p className="text-sm text-white/80">
              O agente pediu ajuda nesta conversa. Responda abaixo ou marque como resolvida quando
              terminar — as ações estão no painel do cliente.
            </p>
          )}
        </div>
      )}

      <SendMessageForm conversationId={conversation.id} />
    </>
  );
}
