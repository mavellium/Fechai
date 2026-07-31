import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { dateTimeLabel, phoneLabel, relativeTime, waLink } from "@/lib/format";
import { leadStatusLabel } from "./leadStatus";
import { ResolveButton } from "./ResolveButton";

export type LeadPanelData = {
  id: string;
  needsHuman: boolean;
  followUpSentAt: Date | null;
  updatedAt: Date;
  agent: { name: string } | null;
  lead: { name: string | null; phone: string; status: string; createdAt: Date };
  messageCount: number;
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-white/5 py-3 first:border-t-0 first:pt-0">
      <dt className="font-mono text-micro uppercase tracking-[0.15em] text-white/50">{label}</dt>
      <dd className="mt-1 text-sm text-white/85">{children}</dd>
    </div>
  );
}

/**
 * Contexto do lead + o que fazer a seguir.
 *
 * Antes, abrir uma conversa mostrava só o nome e o telefone: não dava para saber
 * desde quando o cliente fala com o agente, qual agente atendeu, se já houve
 * follow-up — nem havia ação nenhuma disponível. Esta coluna é o fim do "beco
 * sem saída" do handoff.
 */
export function LeadPanel({ conversation }: { conversation: LeadPanelData }) {
  const status = leadStatusLabel(conversation.lead.status);
  const wa = waLink(conversation.lead.phone);

  return (
    <div className="space-y-5">
      <div>
        <p className="font-mono text-micro uppercase tracking-[0.15em] text-white/50">Situação</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge tone={status.tone}>{status.label}</Badge>
          {conversation.needsHuman && <Badge tone="danger">precisa de você</Badge>}
        </div>
      </div>

      <dl>
        <Row label="Telefone">
          <span className="font-mono">{phoneLabel(conversation.lead.phone)}</span>
        </Row>
        <Row label="Primeiro contato">
          <time dateTime={conversation.lead.createdAt.toISOString()}>
            {dateTimeLabel(conversation.lead.createdAt)}
          </time>
        </Row>
        <Row label="Última mensagem">
          <time dateTime={conversation.updatedAt.toISOString()}>
            {relativeTime(conversation.updatedAt)}
          </time>
        </Row>
        <Row label="Mensagens trocadas">
          <span className="tabular-nums">{conversation.messageCount}</span>
        </Row>
        <Row label="Atendido por">{conversation.agent?.name ?? "Agente removido"}</Row>
        {conversation.followUpSentAt && (
          <Row label="Follow-up">
            <time dateTime={conversation.followUpSentAt.toISOString()}>
              enviado {relativeTime(conversation.followUpSentAt)}
            </time>
          </Row>
        )}
      </dl>

      <div className="space-y-2">
        <ResolveButton
          conversationId={conversation.id}
          needsHuman={conversation.needsHuman}
        />
        {wa ? (
          <ButtonLink
            href={wa}
            target="_blank"
            rel="noopener noreferrer"
            variant="outline"
            size="sm"
            className="w-full"
          >
            Responder no WhatsApp
            <ExternalLink size={14} aria-hidden />
            <span className="sr-only">(abre em nova aba)</span>
          </ButtonLink>
        ) : (
          // O lead do sandbox tem telefone literal "sandbox": não há número para
          // abrir. Dizer isso é melhor do que oferecer um link quebrado.
          <p className="text-xs leading-relaxed text-white/50">
            Esta é a conversa de teste do sandbox — não há número de WhatsApp para responder.
          </p>
        )}
      </div>
    </div>
  );
}
