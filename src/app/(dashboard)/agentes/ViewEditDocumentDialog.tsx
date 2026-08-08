"use client";

import * as React from "react";
import { useActionState, useEffect } from "react";
import { Eye, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, fieldProps } from "@/components/ui/field";
import { FormFeedback } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { getDocumentContent, updateDocumentAction } from "./actions";

type Result = { ok: boolean; error?: string; info?: string };

/**
 * Ver e editar o texto que o agente usa de um documento — antes só dava para
 * ver título + status na lista. O texto vem sob demanda ao abrir (não junto da
 * lista, que pode ter muitos documentos grandes).
 *
 * Segue o mesmo padrão do ConfirmButton: `<dialog>` nativo com `showModal()` —
 * foco preso, Esc fecha, sem lib de modal.
 */
export function ViewEditDocumentDialog({
  agentId,
  documentId,
  title,
  hasFile,
}: {
  agentId: string;
  documentId: string;
  title: string;
  hasFile: boolean;
}) {
  const ref = React.useRef<HTMLDialogElement>(null);
  const [loading, setLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [content, setContent] = React.useState<string | null>(null);
  const [editedTitle, setEditedTitle] = React.useState(title);

  const [state, formAction, pending] = useActionState<Result | null, FormData>(
    updateDocumentAction,
    null,
  );

  useEffect(() => {
    if (state?.ok) ref.current?.close();
  }, [state]);

  async function open() {
    ref.current?.showModal();
    setLoading(true);
    setLoadError(null);
    const res = await getDocumentContent(agentId, documentId);
    if (res.ok) {
      setContent(res.content);
      setEditedTitle(res.title);
    } else {
      setLoadError(res.error);
    }
    setLoading(false);
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="text-white/60 enabled:hover:text-white"
        aria-label={`Ver e editar documento ${title}`}
        onClick={open}
      >
        <Eye size={16} aria-hidden />
      </Button>

      <dialog
        ref={ref}
        aria-labelledby="kb-doc-title"
        className={cn(
          "m-auto w-[calc(100%-2rem)] max-w-2xl rounded-surface border p-6 backdrop:bg-ink/70",
          "border-ink/10 bg-white text-ink",
          "panel:border-white/15 panel:bg-ink panel:text-white",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="kb-doc-title" className="font-display text-lg font-semibold">
            Documento da base de conhecimento
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Fechar"
            onClick={() => ref.current?.close()}
          >
            <X size={18} aria-hidden />
          </Button>
        </div>

        {loading ? (
          <p className="mt-6 text-sm text-neutral panel:text-white/65">Carregando texto…</p>
        ) : loadError ? (
          <FormFeedback error={loadError} />
        ) : content !== null ? (
          <form action={formAction} className="mt-4 space-y-4">
            <input type="hidden" name="agentId" value={agentId} />
            <input type="hidden" name="documentId" value={documentId} />

            <Field label="Título do documento" htmlFor="kb-edit-title">
              <Input
                {...fieldProps("kb-edit-title")}
                name="title"
                value={editedTitle}
                onChange={(e) => setEditedTitle(e.target.value)}
                required
              />
            </Field>

            <Field
              label="Texto usado pelo agente"
              htmlFor="kb-edit-content"
              hint={
                hasFile
                  ? "Extraído do arquivo enviado. Editar aqui muda só o texto que o agente usa — o arquivo original continua disponível para download."
                  : "Este é o texto que o agente consulta para responder."
              }
            >
              <Textarea
                {...fieldProps("kb-edit-content", { hint: true })}
                name="content"
                rows={14}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="font-mono text-xs"
                required
              />
            </Field>

            <FormFeedback error={state?.error} info={state?.info} />

            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => ref.current?.close()} disabled={pending}>
                Cancelar
              </Button>
              <Button type="submit" loading={pending} loadingLabel="Salvando">
                Salvar alterações
              </Button>
            </div>
          </form>
        ) : null}
      </dialog>
    </>
  );
}
