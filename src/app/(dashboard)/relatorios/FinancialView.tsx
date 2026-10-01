"use client";

import { useEffect, useRef, useState } from "react";
import { useActionToast } from "@/components/ui/toast";
import { useActionState } from "react";
import { Pencil, TrendingUp, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FormFeedback } from "@/components/ui/alert";
import { Stat } from "@/components/ui/stat";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Field, fieldProps } from "@/components/ui/field";
import { SelectMenu } from "@/components/ui/select-menu";
import { dateLabel, formatBRL } from "@/lib/format";
import type { FinancialSummary } from "@/modules/reports/service";
import { saveLeadValue } from "./actions";
import { FinancialCharts } from "./FinancialCharts";
import { UnsavedForm, useUnsavedNavigation } from "@/components/ui/unsaved-changes";

/**
 * Visão Financeira de /relatorios. Número central é o retorno ESTIMADO (nunca
 * exato — o valor por lead é definido pelo dono e o investido presume o preço
 * do plano atual por todo o período), sempre acompanhado do selo de ROI.
 *
 * Estrutura: linha de KPIs (Retorno, Investido, ROI, Ponto de equilíbrio) →
 * gráfico principal (retorno acumulado × investido, largura cheia) → grade de
 * 2 colunas com os demais. Sem valor por lead definido, os gráficos que
 * dependem dele mostram o estado vazio com a chamada para definir — nunca um
 * gráfico de zeros (a série inteira seria inventada).
 */
export function FinancialView({ summary }: { summary: FinancialSummary }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const confirmNavigation = useUnsavedNavigation();
  const close = () => confirmNavigation(() => dialog.current?.close(), dialog.current);
  const [state, formAction, pending] = useActionState(saveLeadValue, null);
  const [mode, setMode] = useState("correct");
  const [dialogVersion, setDialogVersion] = useState(0);
  const [previousFeedback, setPreviousFeedback] = useState(state);
  useActionToast(state, pending, { entity: "valor do lead" });

  useEffect(() => {
    if (state?.ok) dialog.current?.close();
  }, [state]);

  const roi = summary.roiPercent;
  const roiTone = roi === null || roi === 0 ? "neutral" : roi > 0 ? "success" : "danger";
  const monthsLabel = summary.months === 1 ? "1 mês" : `${summary.months} meses`;
  const leadsLabel = summary.closedLeads === 1 ? "lead fechado" : "leads fechados";
  const hasValue = summary.valuePerLeadCents !== null;

  const canCorrect = Boolean(summary.valueId && summary.valueStartsAt);
  const openValueDialog = () => {
    setMode(canCorrect ? "correct" : "new");
    setPreviousFeedback(state); setDialogVersion((v) => v + 1);
    dialog.current?.showModal();
  };

  return (
    <div className="space-y-6">
      {/* Sem valor do lead não há retorno para mostrar: fica só o convite, nunca
          cartões com travessão ou "ROI —" (mesma regra do bloco financeiro do
          relatório mensal). */}
      {hasValue && <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Retorno estimado"
          value={summary.returnCents === null ? "—" : formatBRL(summary.returnCents)}
          hint={
            hasValue
              ? `${summary.closedLeads} ${leadsLabel} × ${formatBRL(summary.valuePerLeadCents!)}`
              : "defina o valor do lead"
          }
        />
        <Stat
          label="Investido"
          value={formatBRL(summary.investedCents)}
          hint={`${summary.planName} · ${monthsLabel}`}
        />
        <Stat
          label="ROI"
          value={roi === null ? "—" : `${roi > 0 ? "+" : ""}${roi}%`}
          hint={roi === null ? "sem valor definido" : roi > 0 ? "acima do investido" : roi < 0 ? "abaixo do investido" : "empatado"}
        />
        <Stat
          label="Ponto de equilíbrio"
          value={summary.breakEvenLeads === null ? "—" : `${summary.breakEvenLeads} leads`}
          hint={
            summary.breakEvenLeads === null
              ? "sem valor definido"
              : summary.closedLeads >= summary.breakEvenLeads
                ? "já coberto no período"
                : `faltam ${summary.breakEvenLeads - summary.closedLeads}`
          }
        />
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4 rounded-surface border border-ink/10 bg-white p-4 panel:border-white/10 panel:bg-white/5 sm:p-6">
        <div className="min-w-0">
          <p className="font-mono text-micro uppercase tracking-[0.2em] text-neutral panel:text-white/55">
            Retorno estimado
          </p>
          <p className="mt-2 font-display text-3xl font-bold tabular-nums text-ink panel:text-white">
            {summary.returnCents === null ? "—" : formatBRL(summary.returnCents)}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-neutral panel:text-white/55">
            <Badge tone={roiTone}>{roi === null ? "ROI —" : `ROI ${roi > 0 ? "+" : ""}${roi}%`}</Badge>
            {!hasValue ? (
              <span>Defina o valor do seu lead para ver seu retorno financeiro.</span>
            ) : summary.investedCents === 0 ? (
              <span>
                {summary.closedLeads} {leadsLabel} · investido {formatBRL(0)} (Plano Grátis)
              </span>
            ) : (
              <span>
                {summary.closedLeads} {leadsLabel} × {formatBRL(summary.valuePerLeadCents!)} · investido{" "}
                {formatBRL(summary.investedCents)} ({summary.planName}, {monthsLabel})
              </span>
            )}
          </div>
        </div>

        <div className="shrink-0 text-right">
          <p className="text-sm text-neutral panel:text-white/55">Valor do lead</p>
          {hasValue ? (
            <p className="font-display text-xl font-bold tabular-nums text-ink panel:text-white">
              {formatBRL(summary.valuePerLeadCents!)}
            </p>
          ) : (
            <p className="text-sm text-neutral panel:text-white/55">não definido</p>
          )}
          {summary.valueStartsAt && (
            <p className="text-xs text-neutral panel:text-white/55">desde {dateLabel(summary.valueStartsAt)}</p>
          )}
          <Button type="button" size="sm" variant="outline" className="mt-2" onClick={openValueDialog}>
            <Pencil size={14} aria-hidden />
            {hasValue ? "Alterar valor" : "Definir valor"}
          </Button>
        </div>
      </div>
      </>}

      {hasValue ? (
        <FinancialCharts summary={summary} />
      ) : (
        <Card>
          <EmptyState
            icon={TrendingUp}
            title="Quer ver o retorno estimado?"
            description="O retorno financeiro é opcional. Ele depende de quanto vale um lead fechado para você: defina esse valor e mostramos retorno, ROI, ponto de equilíbrio e a evolução mês a mês. Sem ele, não mostramos números inventados."
            action={
              <Button type="button" size="sm" onClick={openValueDialog}>
                <Pencil size={14} aria-hidden />
                Definir valor do lead
              </Button>
            }
          />
        </Card>
      )}

      <dialog
        ref={dialog}
        onCancel={(event) => { event.preventDefault(); close(); }}
        aria-labelledby="valor-do-lead-titulo"
        className="m-auto w-[min(28rem,92vw)] rounded-surface border border-white/15 bg-ink p-6 text-white backdrop:bg-ink/70"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id="valor-do-lead-titulo" className="font-display text-lg font-semibold">
              Valor do lead
            </h2>
            <p className="mt-1 text-sm text-white/55">
              Quanto vale para você um lead que agendou um horário.
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

        <UnsavedForm key={dialogVersion} action={formAction} result={state} label="Valor do lead" className="space-y-4">
          {canCorrect ? <div className="space-y-1.5"><p id="valor-do-lead-modo" className="text-sm font-medium">Como aplicar a alteração</p>
            <SelectMenu label="Como aplicar a alteração" labelledBy="valor-do-lead-modo" name="mode" value={mode} onChange={setMode} disabled={pending}
              options={[{ value: "correct", label: "Corrigir o valor exibido" }, { value: "new", label: "Novo valor a partir de agora" }]} /></div>
            : <input type="hidden" name="mode" value="new" />}
          {canCorrect && <>
            <input type="hidden" name="valueId" value={summary.valueId!} />
            <input type="hidden" name="valueBefore" value={summary.valuePerLeadCents ?? ""} />
            <input type="hidden" name="valueStartsAt" value={new Date(summary.valueStartsAt!).toISOString()} />
          </>}
          <Field
            label="Valor por lead (R$)"
            htmlFor="valor-do-lead-valor"
            hint="Ex.: 500,00. Estimativa por contato que agendou."
          >
            <CurrencyInput
              {...fieldProps("valor-do-lead-valor")}
              name="value"
              defaultValueCents={summary.valuePerLeadCents}
              autoFocus
              required
              placeholder="0,00"
            />
          </Field>

          <p className="text-sm text-white/65">{canCorrect && mode === "correct"
            ? `Corrige a vigência de ${dateLabel(summary.valueStartsAt!)} e recalcula todos os períodos que usam esse valor, inclusive o exibido. Relatórios mensais aprovados mantêm o snapshot entregue.`
            : hasValue ? "Cria uma nova vigência a partir de agora. Períodos iniciados antes continuam usando o valor anterior."
              : "Define a primeira estimativa por lead. Períodos sem uma vigência anterior também usam este valor."}</p>

          <FormFeedback error={state !== previousFeedback ? state?.error : undefined} info={state !== previousFeedback && state?.ok ? state.info : undefined} />

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={close}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button type="submit" size="sm" loading={pending} loadingLabel="Salvando valor">
              {canCorrect && mode === "correct" ? "Salvar correção" : "Salvar novo valor"}
            </Button>
          </div>
        </UnsavedForm>
      </dialog>
    </div>
  );
}
