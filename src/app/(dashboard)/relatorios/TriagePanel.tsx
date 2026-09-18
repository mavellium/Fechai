"use client";

import { useEffect, useRef } from "react";
import { useActionState } from "react";
import { Clock, Filter, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FormFeedback } from "@/components/ui/alert";
import { Stat } from "@/components/ui/stat";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Field, fieldProps } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { formatBRL } from "@/lib/format";
import { HorizontalBars } from "@/components/charts/HorizontalBars";
import type { TriageSummary } from "@/modules/reports/service";
import { saveAttendanceCost } from "./actions";
import { UnsavedForm, useUnsavedNavigation } from "@/components/ui/unsaved-changes";

/**
 * Triagem: o que o agente filtrou antes de ocupar uma pessoa.
 *
 * A pergunta que este bloco responde é "quantos contatos o agente resolveu
 * sozinho porque nunca foram clientes, e o que isso poupou". O número duro
 * (contatos filtrados) aparece SEMPRE; tempo e dinheiro só quando a clínica
 * declarou quanto custa um atendimento — sem isso seriam uma média inventada,
 * que o cliente confere e não bate.
 *
 * Por isso o estado vazio aqui não é "não há dados": é "o número existe, falta
 * a régua para convertê-lo".
 */

/** "95 min" → "1 h 35 min". Horas cheias sem resto omitem os minutos. */
function formatDuration(totalMinutes: number): string {
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

export function TriagePanel({ triage }: { triage: TriageSummary }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const confirmNavigation = useUnsavedNavigation();
  const close = () => confirmNavigation(() => dialog.current?.close(), dialog.current);
  const [state, formAction, pending] = useActionState(saveAttendanceCost, null);

  useEffect(() => {
    if (state?.ok) dialog.current?.close();
  }, [state]);

  const open = () => dialog.current?.showModal();

  const hasCost = triage.minutesPerLead !== null && triage.hourlyCostCents !== null;
  const { screened, previousScreened } = triage;
  const delta = screened - previousScreened;
  const contactsLabel = screened === 1 ? "contato" : "contatos";

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Stat
          label="Contatos filtrados"
          value={String(screened)}
          hint={
            previousScreened === 0 && screened === 0
              ? "nenhum no período"
              : `${delta >= 0 ? "↑" : "↓"}${Math.abs(delta)} vs. período anterior`
          }
        />
        <Stat
          label="Tempo economizado"
          value={triage.minutesSaved === null ? "—" : formatDuration(triage.minutesSaved)}
          hint={
            hasCost
              ? `${screened} ${contactsLabel} × ${triage.minutesPerLead} min`
              : "defina o custo do atendimento"
          }
        />
        <Stat
          label="Economia estimada"
          value={triage.savedCents === null ? "—" : formatBRL(triage.savedCents)}
          hint={
            hasCost
              ? `a ${formatBRL(triage.hourlyCostCents!)}/hora de atendente`
              : "defina o custo do atendimento"
          }
        />
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4 rounded-surface border border-ink/10 bg-white p-4 panel:border-white/10 panel:bg-white/5 sm:p-6">
        <div className="min-w-0">
          <p className="font-mono text-micro uppercase tracking-[0.2em] text-neutral panel:text-white/55">
            Triagem do agente
          </p>
          <p className="mt-2 max-w-prose text-sm text-neutral panel:text-white/55">
            {screened === 0 ? (
              <>
                Nenhum contato foi filtrado neste período. Quando o agente
                identificar alguém que não procura atendimento, ele encerra a
                conversa sozinho e o contato aparece aqui.
              </>
            ) : hasCost ? (
              <>
                O agente encerrou {screened} {contactsLabel} que não eram
                clientes em potencial — cerca de{" "}
                {formatDuration(triage.minutesSaved!)} que ninguém da equipe
                precisou gastar.
              </>
            ) : (
              <>
                O agente encerrou {screened} {contactsLabel} que não eram
                clientes em potencial. Diga quanto custa um atendimento à mão
                para ver isso em tempo e em dinheiro.
              </>
            )}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <p className="text-sm text-neutral panel:text-white/55">Custo do atendimento</p>
          {hasCost ? (
            <p className="font-display text-xl font-bold tabular-nums text-ink panel:text-white">
              {triage.minutesPerLead} min
            </p>
          ) : (
            <p className="text-sm text-neutral panel:text-white/55">não definido</p>
          )}
          {hasCost && (
            <p className="text-xs text-neutral panel:text-white/55">
              a {formatBRL(triage.hourlyCostCents!)}/hora
            </p>
          )}
          <Button type="button" size="sm" variant="outline" className="mt-2" onClick={open}>
            <Pencil size={14} aria-hidden />
            {hasCost ? "Alterar custo" : "Definir custo"}
          </Button>
        </div>
      </div>

      {triage.byReason.length > 0 ? (
        <Card>
          <div className="mb-4">
            <h3 className="font-display text-base font-semibold text-ink panel:text-white">
              Por que foram filtrados
            </h3>
            <p className="mt-1 text-sm text-neutral panel:text-white/55">
              O motivo que o agente registrou ao encerrar cada conversa.
            </p>
          </div>
          <HorizontalBars
            points={triage.byReason.map((r) => ({
              key: r.reason,
              label: r.label,
              value: r.count,
            }))}
            formatValue={(v) => `${v} ${v === 1 ? "contato" : "contatos"}`}
            empty="Nenhum motivo registrado no período."
          />
        </Card>
      ) : (
        <Card>
          <EmptyState
            icon={Filter}
            title="Nenhum contato filtrado ainda"
            description="Ative a habilidade “Triagem de contatos” do agente em Agentes › Habilidades. Com ela, quem não procura atendimento é encerrado com educação, sem passar pela sua fila."
          />
        </Card>
      )}

      <dialog
        ref={dialog}
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        aria-labelledby="custo-atendimento-titulo"
        className="m-auto w-[min(28rem,92vw)] rounded-surface border border-white/15 bg-ink p-6 text-white backdrop:bg-ink/70"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id="custo-atendimento-titulo" className="font-display text-lg font-semibold">
              Custo do atendimento
            </h2>
            <p className="mt-1 text-sm text-white/55">
              Quanto custa atender um contato à mão. É o que converte a triagem
              do agente em tempo e dinheiro.
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Fechar"
            className="shrink-0 rounded-control p-1 text-white/60 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        <UnsavedForm
          action={formAction}
          result={state}
          label="Custo do atendimento"
          className="space-y-4"
        >
          <Field
            label="Minutos por atendimento"
            htmlFor="custo-atendimento-minutos"
            hint="Quanto tempo alguém da equipe gasta para ler, responder e descartar um contato fora do perfil. Ex.: 8."
          >
            <Input
              {...fieldProps("custo-atendimento-minutos")}
              name="minutes"
              type="number"
              inputMode="numeric"
              min={1}
              max={480}
              autoFocus
              required
              placeholder="8"
              defaultValue={triage.minutesPerLead ?? ""}
            />
          </Field>

          <Field
            label="Custo da hora do atendente (R$)"
            htmlFor="custo-atendimento-hora"
            hint={
              triage.hourlyCostCents !== null
                ? `Hoje: ${formatBRL(triage.hourlyCostCents)}/hora. Passa a valer a partir de agora — períodos já iniciados mantêm o custo anterior.`
                : "Salário e encargos por hora de quem faz esse atendimento. Passa a valer a partir de agora — períodos já iniciados mantêm o custo anterior."
            }
          >
            {/* CurrencyInput guarda os dígitos em estado próprio e por isso
                não aceita `defaultValue` — o valor atual aparece no hint. */}
            <CurrencyInput
              {...fieldProps("custo-atendimento-hora")}
              name="hourly"
              required
              placeholder="0,00"
            />
          </Field>

          <p className="flex items-start gap-2 text-xs text-white/55">
            <Clock size={14} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              A economia é uma estimativa: multiplica os contatos filtrados por
              este custo. Vale o que a régua valer.
            </span>
          </p>

          <FormFeedback error={state?.error} info={state?.ok ? state.info : undefined} />

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={close} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" loading={pending} loadingLabel="Salvando custo">
              Salvar
            </Button>
          </div>
        </UnsavedForm>
      </dialog>
    </div>
  );
}
