import { cn } from "@/lib/utils";

export type ChatRole = "user" | "assistant";

/**
 * Bolha de mensagem — a mesma no sandbox, no histórico de conversas e na prévia
 * do onboarding.
 *
 * Existe porque as três telas desenhavam a bolha à mão e **duas discordavam**:
 * em /conversas o lead saía branco à esquerda e o agente iris à direita, o
 * inverso do sandbox. Quem testava no sandbox e depois abria o histórico via os
 * papéis trocados. A convenção única é a de app de mensagem:
 *
 * - `user` (o lead) → iris, alinhado à direita
 * - `assistant` (o agente) → claro, alinhado à esquerda
 */
export function ChatBubble({
  role,
  children,
  footer,
}: {
  role: ChatRole;
  children: React.ReactNode;
  /** Linha auxiliar sob a bolha (ex.: ações executadas pelo agente). */
  footer?: React.ReactNode;
}) {
  const isUser = role === "user";

  return (
    <div className={cn("flex flex-col", isUser ? "items-end" : "items-start")}>
      <span
        className={cn(
          "inline-block max-w-[85%] rounded-surface px-4 py-2 text-sm leading-snug whitespace-pre-wrap break-words",
          // o canto "quebrado" é a pontinha da bolha, do lado de quem fala
          isUser ? "rounded-br-sm bg-iris text-white" : "rounded-bl-sm bg-white text-ink",
        )}
      >
        {children}
      </span>
      {footer && (
        <p className="mt-1 font-mono text-micro uppercase tracking-wide text-neutral panel:text-white/50">
          {footer}
        </p>
      )}
    </div>
  );
}

