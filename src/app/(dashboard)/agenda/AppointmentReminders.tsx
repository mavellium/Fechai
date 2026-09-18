"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BellRing } from "lucide-react";
import {
  formatReminderLead,
  type ReminderRule,
} from "@/modules/scheduling/config";
import {
  ReminderList,
  fromDrafts,
  toDrafts,
  type ReminderDraft,
} from "../agentes/ReminderList";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useUnsavedChanges, useUnsavedNavigation } from "@/components/ui/unsaved-changes";
import { saveAppointmentRemindersAction } from "./actions";

/**
 * Lembretes de UMA consulta, sobrescrevendo os do agente.
 *
 * Existe porque o padrão do agente serve ao caso comum, não a toda consulta:
 * um procedimento que exige preparo pede um aviso na véspera que a consulta
 * de rotina não pede, e o paciente que já faltou duas vezes merece um
 * lembrete a mais sem mudar a régua de todo mundo.
 *
 * A distinção que a tela precisa deixar clara é entre **seguir o agente**
 * (nada configurado aqui) e **não receber lembrete** (lista vazia): as duas
 * parecem "vazio", e confundi-las faz o paciente errado receber — ou deixar
 * de receber — a mensagem.
 */
export function AppointmentReminders({
  id,
  title,
  override,
  agentReminders,
  location,
  sentCount,
}: {
  id: string;
  title: string;
  /** Lembretes só desta consulta. `null` = segue o agente. */
  override: ReminderRule[] | null;
  /** O padrão do agente, mostrado quando não há override. */
  agentReminders: ReminderRule[];
  location: string;
  /** Quantos disparos já saíram — o que não dá para desfazer. */
  sentCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // `null` no estado significa o mesmo que no banco: segue o agente. A lista
  // mostrada nesse caso é a do agente, mas só vira override quando a pessoa
  // toca em alguma coisa (`custom`).
  const [custom, setCustom] = useState(override !== null);
  const [drafts, setDrafts] = useState<ReminderDraft[]>(() =>
    toDrafts(override ?? agentReminders),
  );
  const contentRef = useRef<HTMLFieldSetElement>(null);
  const [saved, setSaved] = useState(() => JSON.stringify({ custom: override !== null, drafts: toDrafts(override ?? agentReminders) }));
  const confirmNavigation = useUnsavedNavigation();
  useUnsavedChanges(open && (pending || JSON.stringify({ custom, drafts }) !== saved), "Lembretes da consulta", contentRef);
  function close() {
    if (!pending) confirmNavigation(() => setOpen(false), contentRef.current);
  }

  function save(next: ReminderDraft[] | null) {
    setError(null);
    startTransition(async () => {
      const res = await saveAppointmentRemindersAction(
        id,
        next === null ? null : fromDrafts(next),
      );
      if (!res.ok) {
        setError(res.error ?? "Não foi possível salvar os lembretes.");
        return;
      }
      setSaved(JSON.stringify({ custom: next !== null, drafts: next ?? toDrafts(agentReminders) }));
      setOpen(false);
      router.refresh();
    });
  }

  const effective = custom ? drafts : toDrafts(agentReminders);

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => {
        const next = toDrafts(override ?? agentReminders);
        setCustom(override !== null);
        setDrafts(next);
        setSaved(JSON.stringify({ custom: override !== null, drafts: next }));
        setError(null);
        setOpen(true);
      }}>
        <BellRing size={14} aria-hidden />
        Lembretes
      </Button>

      <Modal
        open={open}
        onClose={close}
        title={`Lembretes — ${title}`}
        description={
          custom
            ? "Esta consulta usa lembretes próprios."
            : "Esta consulta segue os lembretes configurados no agente."
        }
      >
        <fieldset ref={contentRef} disabled={pending} className="min-w-0 space-y-4">
          {sentCount > 0 && (
            <Alert tone="info">
              {sentCount === 1 ? "1 lembrete já foi enviado" : `${sentCount} lembretes já foram enviados`}{" "}
              para este contato. Mudar a lista não reenvia o que já saiu.
            </Alert>
          )}

          {!custom && (
            <div className="rounded-control border border-white/10 bg-white/[0.03] p-3">
              <p className="font-mono text-micro uppercase tracking-[0.15em] text-white/50">
                Do agente
              </p>
              {agentReminders.length === 0 ? (
                <p className="mt-1.5 text-sm text-white/60">
                  O agente não manda lembrete. Este contato não será avisado.
                </p>
              ) : (
                <ul className="mt-1.5 space-y-1">
                  {agentReminders.map((r) => (
                    <li key={r.minutesBefore} className="text-sm text-white/75">
                      {formatReminderLead(r.minutesBefore)} antes
                    </li>
                  ))}
                </ul>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => setCustom(true)}
              >
                Usar lembretes próprios nesta consulta
              </Button>
            </div>
          )}

          {custom && (
            <>
              <ReminderList
                value={drafts}
                onChange={setDrafts}
                location={location}
                idPrefix={`consulta-${id}`}
              />
              {/* Voltar ao padrão é diferente de apagar a lista: um segue o
                  agente para sempre, o outro é a escolha "esta consulta não
                  recebe lembrete". Por isso são dois caminhos distintos, e
                  não um botão "limpar". */}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setCustom(false);
                  setDrafts(toDrafts(agentReminders));
                }}
              >
                Voltar a seguir o agente
              </Button>
            </>
          )}

          {error && <Alert tone="danger">{error}</Alert>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>
              Fechar
            </Button>
            <Button
              type="button"
              loading={pending}
              loadingLabel="Salvando"
              onClick={() => save(custom ? drafts : null)}
              disabled={!custom && override === null}
            >
              Salvar
            </Button>
          </div>

          {effective.length === 0 && custom && (
            <p className="text-sm text-warn">
              Sem nenhum lembrete na lista, este contato não receberá aviso desta consulta.
            </p>
          )}
        </fieldset>
      </Modal>
    </>
  );
}
