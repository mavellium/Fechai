"use client";

import { useId, useState, useTransition } from "react";
import Link from "next/link";
import { MessageSquareText, Users } from "lucide-react";
import type { GapView } from "@/modules/knowledge-gaps/queue";
import { defaultResumeMessage, MAX_ANSWER, MAX_RESUME_MESSAGE } from "@/modules/knowledge-gaps/text";
import { dateTimeLabel, relativeTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, fieldProps } from "@/components/ui/field";
import { FormFeedback } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Result = { ok: boolean; error?: string; info?: string };

/**
 * O que a tela pode fazer com a pergunta. Vem por prop porque o mesmo card
 * serve à clínica (`/perguntas`) e à Mavellium (`/admin/perguntas`, com o
 * tenant já amarrado na action) — as regras de quem pode estão nas actions.
 */
export type GapCardActions = {
  draft: (gapId: string, text: string) => Promise<Result>;
  approve: (gapId: string, answer: string, resumeMessage: string | null) => Promise<Result>;
  dismiss: (gapId: string) => Promise<Result>;
  reopen: (gapId: string) => Promise<Result>;
  resume: (gapId: string, message: string) => Promise<Result>;
};

const RESUME_LABEL: Record<string, { label: string; tone: "success" | "warn" | "danger" | "neutral" }> = {
  sent: { label: "resposta enviada", tone: "success" },
  skipped: { label: "não retomado", tone: "neutral" },
  failed: { label: "sem confirmação", tone: "danger" },
  sending: { label: "enviando", tone: "warn" },
};

export function GapCard({
  gap,
  actions,
  canAnswer,
  readOnlyReason,
  linkConversations,
}: {
  gap: GapView;
  actions: GapCardActions;
  canAnswer: boolean;
  /** Por que não dá para responder aqui (quem responde é o outro lado). */
  readOnlyReason?: string;
  /** Mostra "Abrir conversa" — só para a clínica, nunca com dado mascarado. */
  linkConversations: boolean;
}) {
  const answerId = useId();
  const resumeId = useId();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Result | null>(null);
  const [editing, setEditing] = useState(gap.status === "open");
  const [answer, setAnswer] = useState(gap.draftAnswer ?? gap.answer ?? "");
  const [resumeOn, setResumeOn] = useState(false);
  const [resumeText, setResumeText] = useState<string | null>(null);
  const resumeMessage = resumeText ?? defaultResumeMessage(answer || gap.answer || "");

  function run(kind: string, fn: () => Promise<Result>) {
    setBusy(kind);
    setFeedback(null);
    start(async () => {
      const res = await fn().catch(() => ({ ok: false, error: "Não foi possível concluir agora. Tente de novo." }));
      setFeedback(res);
      setBusy(null);
      if (res.ok && kind === "approve") {
        setEditing(false);
        setResumeOn(false);
        setResumeText(null);
      }
    });
  }

  const answered = gap.status === "answered";
  const dismissed = gap.status === "dismissed";

  return (
    <Card className="space-y-4 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg font-semibold leading-snug text-ink panel:text-white">“{gap.question}”</h2>
          <p className="mt-1 text-sm text-neutral panel:text-white/60">
            Perguntada pela primeira vez {relativeTime(new Date(gap.firstAskedAt))}
            {gap.askedCount > 1 && <> · última {relativeTime(new Date(gap.lastAskedAt))}</>}
            {gap.agentName && <> · agente {gap.agentName}</>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={gap.askedCount > 1 ? "iris" : "neutral"} icon={<Users size={12} aria-hidden />}>
            {gap.askedCount} {gap.askedCount === 1 ? "contato" : "contatos"}
          </Badge>
          {gap.status === "open" && gap.draftAnswer && <Badge tone="warn">rascunho</Badge>}
          {answered && <Badge tone="success">respondida</Badge>}
          {dismissed && <Badge tone="neutral">descartada</Badge>}
        </div>
      </div>

      {gap.excerpt.length > 0 && (
        <details className="group rounded-control border border-ink/10 panel:border-white/10">
          <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-medium text-ink outline-none focus-visible:ring-2 focus-visible:ring-iris panel:text-white/85">
            <MessageSquareText size={14} aria-hidden />
            Trecho da conversa
          </summary>
          <ol className="space-y-2 border-t border-ink/10 px-3 py-3 panel:border-white/10" aria-label="Trecho da conversa mais recente">
            {gap.excerpt.map((line) => {
              const fromContact = line.role === "user";
              return (
                <li key={line.id} className={cn("flex", fromContact ? "justify-start" : "justify-end")}>
                  <div
                    className={cn(
                      "max-w-[85%] rounded-control px-3 py-2 text-sm leading-relaxed",
                      fromContact ? "bg-ink/5 text-ink panel:bg-white/10 panel:text-white/85" : "bg-iris/10 text-ink panel:bg-iris/20 panel:text-white/85",
                    )}
                  >
                    <p className="mb-1 font-mono text-micro uppercase tracking-wide text-neutral panel:text-white/50">
                      {fromContact ? "contato" : line.sentBy === "human" ? "equipe" : "agente"} · {dateTimeLabel(new Date(line.at))}
                    </p>
                    <p className="whitespace-pre-wrap break-words">{line.content}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </details>
      )}

      <details className="rounded-control border border-ink/10 panel:border-white/10">
        <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-medium text-ink outline-none focus-visible:ring-2 focus-visible:ring-iris panel:text-white/85">
          <Users size={14} aria-hidden />
          Quem perguntou ({gap.askedCount})
        </summary>
        <ul className="divide-y divide-ink/10 border-t border-ink/10 panel:divide-white/10 panel:border-white/10">
          {gap.occurrences.map((o) => {
            const resume = o.resumeStatus ? RESUME_LABEL[o.resumeStatus] : null;
            return (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="text-ink panel:text-white/85">
                    {o.contactName} <span className="font-mono text-xs text-neutral panel:text-white/55">{o.contactPhone}</span>
                  </p>
                  <p className="text-xs text-neutral panel:text-white/55">
                    {dateTimeLabel(new Date(o.askedAt))}
                    {o.resumeNote && <> · {o.resumeNote}</>}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {resume && <Badge tone={resume.tone}>{resume.label}</Badge>}
                  {linkConversations && (
                    <Link
                      href={`/conversas?status=all&id=${o.conversationId}`}
                      className="rounded-control text-sm text-iris underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris panel:text-white/80"
                    >
                      Abrir conversa
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {gap.askedCount > gap.occurrences.length && (
          <p className="border-t border-ink/10 px-3 py-2 text-xs text-neutral panel:border-white/10 panel:text-white/55">
            Mostrando os {gap.occurrences.length} mais recentes.
          </p>
        )}
      </details>

      {answered && !editing && (
        <div className="space-y-2 border-l-2 border-success pl-3">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink panel:text-white/85">{gap.answer}</p>
          <p className="text-xs text-neutral panel:text-white/55">
            Aprovada {gap.answeredAt ? relativeTime(new Date(gap.answeredAt)) : ""}
            {gap.answeredByLabel && <> por {gap.answeredByLabel}</>}
            {gap.answerUpdatedAt && gap.answeredAt && new Date(gap.answerUpdatedAt).getTime() - new Date(gap.answeredAt).getTime() > 60_000 && (
              <> · editada {relativeTime(new Date(gap.answerUpdatedAt))}</>
            )}
          </p>
        </div>
      )}

      {!canAnswer && readOnlyReason && !dismissed && (
        <p className="text-sm text-neutral panel:text-white/60">{readOnlyReason}</p>
      )}

      {canAnswer && editing && !dismissed && (
        <div className="space-y-4">
          <Field
            label={answered ? "Editar resposta" : "Resposta da equipe"}
            htmlFor={answerId}
            hint="Escreva como o agente deve responder. Ao aprovar, este texto entra na base de conhecimento do agente."
          >
            <Textarea
              {...fieldProps(answerId, { hint: true })}
              rows={4}
              maxLength={MAX_ANSWER}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Ex.: Sim, atendemos Unimed nos planos Nacional e Estadual. Outros convênios, só particular."
            />
          </Field>
          {gap.pendingResume > 0 && (
            <ResumeToggle
              id={resumeId}
              count={gap.pendingResume}
              on={resumeOn}
              onToggle={setResumeOn}
              message={resumeMessage}
              onMessage={setResumeText}
            />
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              loading={pending && busy === "approve"}
              loadingLabel="Aprovando"
              disabled={pending || !answer.trim()}
              onClick={() => run("approve", () => actions.approve(gap.id, answer, resumeOn ? resumeMessage : null))}
            >
              {answered ? "Salvar e atualizar o agente" : "Aprovar e ensinar o agente"}
            </Button>
            {!answered && (
              <Button
                type="button"
                variant="outline"
                loading={pending && busy === "draft"}
                loadingLabel="Salvando rascunho"
                disabled={pending}
                onClick={() => run("draft", () => actions.draft(gap.id, answer))}
              >
                Salvar rascunho
              </Button>
            )}
            {answered ? (
              <Button type="button" variant="ghost" disabled={pending} onClick={() => { setEditing(false); setAnswer(gap.answer ?? ""); }}>
                Cancelar
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                loading={pending && busy === "dismiss"}
                loadingLabel="Descartando"
                disabled={pending}
                onClick={() => run("dismiss", () => actions.dismiss(gap.id))}
              >
                Descartar
              </Button>
            )}
          </div>
        </div>
      )}

      {canAnswer && answered && !editing && (
        <div className="space-y-4">
          {gap.pendingResume > 0 && (
            <ResumeToggle
              id={resumeId}
              count={gap.pendingResume}
              on={resumeOn}
              onToggle={setResumeOn}
              message={resumeMessage}
              onMessage={setResumeText}
            />
          )}
          <div className="flex flex-wrap items-center gap-2">
            {resumeOn && (
              <Button
                type="button"
                loading={pending && busy === "resume"}
                loadingLabel="Enviando"
                disabled={pending || !resumeMessage.trim()}
                onClick={() => run("resume", () => actions.resume(gap.id, resumeMessage))}
              >
                Enviar resposta
              </Button>
            )}
            <Button type="button" variant="outline" disabled={pending} onClick={() => setEditing(true)}>
              Editar resposta
            </Button>
          </div>
        </div>
      )}

      {canAnswer && dismissed && (
        <Button
          type="button"
          variant="outline"
          loading={pending && busy === "reopen"}
          loadingLabel="Devolvendo"
          disabled={pending}
          onClick={() => run("reopen", () => actions.reopen(gap.id))}
        >
          Voltar para a fila
        </Button>
      )}

      <FormFeedback error={feedback && !feedback.ok ? feedback.error : null} info={feedback?.ok ? feedback.info : null} />
    </Card>
  );
}

/**
 * Retomar quem ficou esperando. Desligado por padrão: mandar mensagem a um
 * contato real é decisão de quem aprova, a cada vez — nunca efeito colateral
 * de ensinar o agente.
 */
function ResumeToggle({
  id,
  count,
  on,
  onToggle,
  message,
  onMessage,
}: {
  id: string;
  count: number;
  on: boolean;
  onToggle: (next: boolean) => void;
  message: string;
  onMessage: (text: string) => void;
}) {
  const descId = `${id}-desc`;
  return (
    <div className="space-y-3 rounded-control border border-ink/10 p-3 panel:border-white/10">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink panel:text-white/85">
            Enviar a resposta a quem perguntou ({count})
          </p>
          <p id={descId} className="mt-0.5 text-sm text-neutral panel:text-white/60">
            Sai pelo WhatsApp da conta, uma vez por contato. Ficam de fora quem já foi respondido por alguém da equipe,
            pediu para parar ou está fora da janela de envio.
          </p>
        </div>
        <Switch
          checked={on}
          onCheckedChange={onToggle}
          label={`Enviar a resposta a quem perguntou: ${on ? "ligado" : "desligado"}`}
          describedBy={descId}
        />
      </div>
      {on && (
        <Field label="Mensagem para o contato" htmlFor={id}>
          <Textarea
            {...fieldProps(id)}
            rows={3}
            maxLength={MAX_RESUME_MESSAGE}
            value={message}
            onChange={(e) => onMessage(e.target.value)}
          />
        </Field>
      )}
    </div>
  );
}
