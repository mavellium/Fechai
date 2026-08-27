"use client";

import { useActionState, useEffect, useRef, useState, useTransition, type ChangeEvent } from "react";
import { Download, FileText, Trash2 } from "lucide-react";
import posthog from "posthog-js";
import { Alert, FormFeedback } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, fieldProps } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StepTabs, type StepTab } from "./StepTabs";
import { addDocument, removeDocument } from "./actions";
import { ViewEditDocumentDialog } from "./ViewEditDocumentDialog";

type Doc = {
  id: string;
  title: string;
  status: string;
  createdAt: Date;
  fileUrl: string | null;
  fileName: string | null;
};

// Mesmo teto de agentes/actions.ts (MAX_KB_FILE_BYTES) — checar aqui evita que
// o usuário só descubra o limite depois de esperar o upload falhar.
const MAX_FILE_BYTES = 50 * 1024 * 1024;

const STATUS: Record<string, { label: string; tone: "success" | "warn" | "danger" | "neutral" }> = {
  ready: { label: "Pronto", tone: "success" },
  pending: { label: "Processando", tone: "neutral" },
  failed: { label: "Falha nos embeddings", tone: "danger" },
  no_embeddings: { label: "Sem embeddings", tone: "warn" },
};

export function KnowledgeManager({ agentId, documents }: { agentId: string; documents: Doc[] }) {
  const [state, formAction, pending] = useActionState(addDocument, null);
  const [, startRemove] = useTransition();
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // O limite do Next.js (next.config.ts) é aplicado antes da action rodar — um
  // arquivo grande demais derruba a requisição com um 413 cru. Bloquear aqui,
  // no input, evita esse crash e explica o motivo na hora.
  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file && file.size > MAX_FILE_BYTES) {
      setFileError(`"${file.name}" tem ${(file.size / (1024 * 1024)).toFixed(1)}MB — o máximo é 50MB.`);
      event.target.value = "";
      return;
    }
    setFileError(null);
  }

  // Antes o reset era chamado direto no corpo do render enquanto `state.ok`
  // fosse verdadeiro — ou seja, a cada re-render, apagando o que o usuário
  // tivesse acabado de digitar para o próximo documento. Agora roda uma vez,
  // como efeito, quando o resultado muda.
  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  function remove(doc: Doc) {
    setRemoveError(null);
    setRemovingId(doc.id);
    startRemove(async () => {
      posthog.capture("knowledge_document_removed");
      const res = await removeDocument(agentId, doc.id);
      // O retorno da action era descartado com `void`: falha ao apagar sumia
      // em silêncio e o documento continuava na lista sem explicação.
      if (!res.ok) setRemoveError(res.error ?? `Não foi possível remover "${doc.title}".`);
      setRemovingId(null);
    });
  }

  const tabs: StepTab[] = [
    {
      key: "adicionar",
      label: "Adicionar",
      content: (
        <form
          ref={formRef}
          action={formAction}
          className="space-y-4"
          onSubmit={() => posthog.capture("knowledge_document_submitted")}
        >
          <input type="hidden" name="agentId" value={agentId} />
          <Field label="Título do documento" htmlFor="kb-title">
            <Input {...fieldProps("kb-title")} name="title" placeholder="Ex: Tabela de preços" required />
          </Field>

          <Field
            label="Conteúdo"
            htmlFor="kb-content"
            hint="Cole o texto aqui ou envie um arquivo abaixo."
            optional
          >
            <Textarea
              {...fieldProps("kb-content", { hint: true })}
              name="content"
              rows={5}
              placeholder="Cole aqui o texto da sua base de conhecimento..."
            />
          </Field>

          <Field label="Arquivo" htmlFor="kb-file" hint="Aceita .txt, .md ou .pdf. Tamanho máximo: 50MB." optional>
            <input
              {...fieldProps("kb-file", { hint: true })}
              type="file"
              name="file"
              accept=".txt,.md,.pdf"
              onChange={handleFileChange}
              className="w-full text-sm text-white/70 file:mr-3 file:rounded-control file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-sm file:text-white file:transition-colors hover:file:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
            />
          </Field>

          {fileError && <Alert tone="warn">{fileError}</Alert>}

          <FormFeedback error={state?.error} info={state?.info} />

          <Button type="submit" loading={pending} loadingLabel="Enviando documento">
            Adicionar à base
          </Button>
        </form>
      ),
    },
    {
      key: "documentos",
      label: `Documentos (${documents.length})`,
      content: (
        <div>
          {removeError && (
            <Alert tone="danger" className="mb-3">
              {removeError}
            </Alert>
          )}

          {documents.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="Nenhum documento na base"
              description="O agente responde só com o que você ensinar. Comece com o texto que você mais repete para clientes — preços, horários, como funciona."
            />
          ) : (
            <ul className="space-y-2">
              {documents.map((d) => {
                const s = STATUS[d.status] ?? { label: d.status, tone: "neutral" as const };
                return (
                  <li
                    key={d.id}
                    className="flex items-center justify-between gap-3 rounded-surface border border-white/10 p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-white">{d.title}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <Badge tone={s.tone}>{s.label}</Badge>
                        {d.fileUrl && (
                          <a
                            href={d.fileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-white/60 underline-offset-2 hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
                          >
                            <Download size={12} aria-hidden />
                            {d.fileName ?? "arquivo original"}
                          </a>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <ViewEditDocumentDialog
                        agentId={agentId}
                        documentId={d.id}
                        title={d.title}
                        hasFile={Boolean(d.fileUrl)}
                      />

                      <ConfirmButton
                        variant="ghost"
                        size="icon"
                        className="text-white/60 enabled:hover:text-danger"
                        aria-label={`Remover documento ${d.title}`}
                        disabled={removingId === d.id}
                        confirm={{
                          title: "Remover da base de conhecimento?",
                          description: `"${d.title}" sai da base e o agente deixa de usar esse conteúdo nas respostas. Não dá para desfazer.`,
                          confirmLabel: "Remover documento",
                          tone: "danger",
                        }}
                        onConfirm={() => remove(d)}
                      >
                        <Trash2 size={16} aria-hidden />
                      </ConfirmButton>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ),
    },
  ];

  return <StepTabs tabs={tabs} />;
}
