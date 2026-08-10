"use client";

import { useEffect, useRef } from "react";
import { useActionState } from "react";
import { Pencil, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { FormFeedback } from "@/components/ui/alert";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Field, fieldProps } from "@/components/ui/field";
import { dateLabel, formatBRL } from "@/lib/format";
import type { FinancialSummary } from "@/modules/reports/service";
import { saveLeadValue } from "./actions";

/**
 * Visão Financeira de /relatorios. Número central é o retorno ESTIMADO (nunca
 * exato — o valor por lead é definido pelo dono e o investido presume o preço
 * do plano atual por todo o período), sempre acompanhado do selo de ROI.
 */
export function FinancialView({ summary }: { summary: FinancialSummary }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, formAction, pending] = useActionState(saveLeadValue, null);

  useEffect(() => {
    if (state?.ok) dialog.current?.close();
  }, [state]);

  const roi = summary.roiPercent;
  const roiTone = roi === null || roi === 0 ? "neutral" : roi > 0 ? "success" : "danger";
  const monthsLabel = summary.months === 1 ? "1 mês" : `${summary.months} meses`;
  const leadsLabel = summary.closedLeads === 1 ? "lead fechado" : "leads fechados";

  const kpiHint =
    summary.valuePerLeadCents === null
      ? "Leads fechados no período, ainda sem valor definido para calcular o retorno."
      : "Retorno potencial dos leads fechados no período — estimado.";

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardTitle hint={kpiHint}>Retorno estimado</CardTitle>

        <p className="font-display text-4xl font-bold tabular-nums text-ink panel:text-white">
          {summary.returnCents === null ? "—" : formatBRL(summary.returnCents)}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-neutral panel:text-white/55">
          <Badge tone={roiTone}>
            {roi === null ? "ROI —" : `ROI ${roi > 0 ? "+" : ""}${roi}%`}
          </Badge>
          {summary.valuePerLeadCents === null ? (
            <span>Defina o valor do seu lead para ver seu retorno financeiro.</span>
          ) : summary.investedCents === 0 ? (
            <span>
              {summary.closedLeads} {leadsLabel} · investido {formatBRL(0)} (Plano Grátis)
            </span>
          ) : (
            <span>
              {summary.closedLeads} {leadsLabel} × {formatBRL(summary.valuePerLeadCents)} · investido{" "}
              {formatBRL(summary.investedCents)} ({summary.planName}, {monthsLabel})
            </span>
          )}
        </div>
      </Card>

      <Card>
        <CardTitle hint="Quanto vale para você um lead que agendou um horário.">
          Valor do lead
        </CardTitle>

        {summary.valuePerLeadCents === null ? (
          <p className="text-sm text-neutral panel:text-white/55">
            Ainda não definido. Salve um valor para os próximos períodos começarem a mostrar o
            retorno.
          </p>
        ) : (
          <p className="font-display text-3xl font-bold tabular-nums text-ink panel:text-white">
            {formatBRL(summary.valuePerLeadCents)}
          </p>
        )}

        {summary.valueStartsAt && (
          <p className="mt-1 text-xs text-neutral panel:text-white/55">
            Vigente desde {dateLabel(summary.valueStartsAt)}
          </p>
        )}

        <div className="mt-3">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => dialog.current?.showModal()}
          >
            <Pencil size={14} aria-hidden />
            {summary.valuePerLeadCents === null ? "Definir valor" : "Alterar valor"}
          </Button>
        </div>

        <dialog
          ref={dialog}
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
              onClick={() => dialog.current?.close()}
              aria-label="Fechar"
              className="shrink-0 rounded-control p-1 text-white/60 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
            >
              <X size={18} aria-hidden />
            </button>
          </div>

          <form action={formAction} className="space-y-4">
            <Field
              label="Valor por lead (R$)"
              htmlFor="valor-do-lead-valor"
              hint="Ex.: 500,00. Passa a valer a partir de agora — períodos já iniciados mantêm o valor anterior."
            >
              <CurrencyInput
                {...fieldProps("valor-do-lead-valor")}
                name="value"
                autoFocus
                required
                placeholder="0,00"
              />
            </Field>

            <FormFeedback error={state?.error} info={state?.ok ? state.info : undefined} />

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => dialog.current?.close()}
                disabled={pending}
              >
                Cancelar
              </Button>
              <Button type="submit" size="sm" loading={pending} loadingLabel="Salvando valor">
                Salvar
              </Button>
            </div>
          </form>
        </dialog>
      </Card>
    </div>
  );
}
