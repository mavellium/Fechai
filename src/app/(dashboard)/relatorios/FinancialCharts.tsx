"use client";

import { Card, CardTitle } from "@/components/ui/card";
import { ChartActions } from "@/components/charts/ChartActions";
import { ChartTable } from "@/components/charts/ChartTable";
import { DivergingBars } from "@/components/charts/DivergingBars";
import { HorizontalBars } from "@/components/charts/HorizontalBars";
import { Stat } from "@/components/ui/stat";
import { formatBRL } from "@/lib/format";
import type { FinancialSummary } from "@/modules/reports/service";
import { SeriesChart } from "./SeriesChart";

/**
 * Gráficos da visão Financeira — só renderizado quando `valuePerLeadCents`
 * está definido (`FinancialView` decide isso; aqui os arrays já chegam não
 * nulos). Todos herdam o contrato de estimativa da visão: "estimado" no texto,
 * `formatBRL()` em todo valor.
 */
export function FinancialCharts({ summary }: { summary: FinancialSummary }) {
  const cumulative = summary.cumulative ?? [];
  const byAgent = summary.byAgent ?? [];
  const monthly = summary.monthly ?? [];

  const totalReturn = cumulative[cumulative.length - 1]?.returnCents ?? 0;
  const totalInvested = cumulative[cumulative.length - 1]?.investedCents ?? 0;

  const cumulativeSources: [string, string][] = [
    ["Retorno acumulado no fim do período", formatBRL(totalReturn)],
    ["Investido acumulado no fim do período", formatBRL(totalInvested)],
    ["Investido", "distribuído em partes iguais pelos buckets — estimado"],
    ["Período coberto", `${cumulative[0]?.label ?? "—"} a ${cumulative[cumulative.length - 1]?.label ?? "—"}`],
  ];

  const monthlyTable = {
    head: ["Mês", "Lucro/Prejuízo"],
    rows: monthly.map((p) => [p.label, formatBRL(p.netCents)]),
    foot: ["Total", formatBRL(monthly.reduce((s, p) => s + p.netCents, 0))],
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardTitle
          hint="Retorno acumulado × investido acumulado — onde as linhas se cruzam é o payback estimado."
          action={
            <ChartActions
              label="retorno acumulado × investido"
              title="Retorno acumulado × investido"
              hint="Um eixo só — as duas séries estão em reais."
              description="Retorno acumulado: soma dos agendamentos efetivados no período × valor por lead, bucket a bucket. Investido acumulado: preço do plano distribuído em partes iguais pelos mesmos buckets (o modelo não guarda histórico de assinatura, então usa o plano atual por todo o período). Onde as linhas se cruzam é o ponto em que o retorno passou a cobrir o investido — estimado."
              sources={cumulativeSources}
              full={
                <>
                  <SeriesChart
                    points={cumulative.map((p) => ({ key: p.key, label: p.label, a: p.returnCents, b: p.investedCents }))}
                    labelA="Retorno acumulado"
                    labelB="Investido acumulado"
                    colorA="text-success"
                    colorB="text-neutral"
                    empty="Nenhum agendamento efetivado no período."
                    formatValue={formatBRL}
                    className="h-64"
                  />
                  <ChartTable
                    head={["Período", "Retorno acumulado", "Investido acumulado"]}
                    rows={cumulative.map((p) => [p.label, formatBRL(p.returnCents), formatBRL(p.investedCents)])}
                    foot={["Fim do período", formatBRL(totalReturn), formatBRL(totalInvested)]}
                  />
                </>
              }
            />
          }
        >
          Retorno acumulado × investido
        </CardTitle>
        <SeriesChart
          points={cumulative.map((p) => ({ key: p.key, label: p.label, a: p.returnCents, b: p.investedCents }))}
          labelA="Retorno acumulado"
          labelB="Investido acumulado"
          colorA="text-success"
          colorB="text-neutral"
          empty="Nenhum agendamento efetivado no período."
          formatValue={formatBRL}
        />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle
            hint="Quem fechou os agendamentos que geraram retorno no período."
            action={
              <ChartActions
                label="retorno por agente"
                title="Retorno por agente"
                hint="Agendamentos efetivados × valor por lead, por agente."
                description="Cada agendamento efetivado (status marcado ou concluído) no período multiplicado pelo valor por lead em vigor. Agendamentos sem agente vinculado aparecem como 'Sem agente'."
                sources={[
                  ["Agentes com retorno", String(byAgent.length)],
                  ["Retorno total no período", formatBRL(byAgent.reduce((s, a) => s + a.returnCents, 0))],
                ]}
                full={
                  <ChartTable
                    head={["Agente", "Retorno", "Leads fechados"]}
                    rows={byAgent.map((a) => [a.name, formatBRL(a.returnCents), String(a.closedLeads)])}
                    foot={[
                      "Total",
                      formatBRL(byAgent.reduce((s, a) => s + a.returnCents, 0)),
                      String(byAgent.reduce((s, a) => s + a.closedLeads, 0)),
                    ]}
                  />
                }
              />
            }
          >
            Retorno por agente
          </CardTitle>
          <HorizontalBars
            points={byAgent.map((a) => ({
              key: a.name,
              label: a.name,
              value: a.returnCents,
              secondaryLabel: `${a.closedLeads} ${a.closedLeads === 1 ? "lead" : "leads"}`,
            }))}
            formatValue={formatBRL}
            empty="Nenhum agendamento efetivado no período."
          />
        </Card>

        <Card>
          <CardTitle
            hint="Lucro (verde) acima da linha, prejuízo (âmbar) abaixo — mês a mês."
            action={
              <ChartActions
                label="retorno mês a mês"
                title="Retorno mês a mês"
                hint="Retorno menos investido, por mês de calendário."
                description="Cada barra é o retorno do mês (agendamentos efetivados × valor por lead) menos o investido do mês (plano dividido em partes iguais pelos meses do período). Acima da linha é lucro; abaixo é prejuízo. Estimado — mesmas regras da visão Financeira."
                sources={[
                  ["Meses com lucro", String(monthly.filter((p) => p.netCents > 0).length)],
                  ["Meses com prejuízo", String(monthly.filter((p) => p.netCents < 0).length)],
                  ["Total do período", formatBRL(monthly.reduce((s, p) => s + p.netCents, 0))],
                ]}
                full={
                  <>
                    <DivergingBars
                      points={monthly.map((p) => ({ key: p.key, label: p.label, value: p.netCents }))}
                      formatValue={formatBRL}
                      className="h-64"
                    />
                    <ChartTable head={monthlyTable.head} rows={monthlyTable.rows} foot={monthlyTable.foot} />
                  </>
                }
              />
            }
          >
            Retorno mês a mês
          </CardTitle>
          <DivergingBars
            points={monthly.map((p) => ({ key: p.key, label: p.label, value: p.netCents }))}
            formatValue={formatBRL}
          />
        </Card>
      </div>

      <Card>
        <CardTitle hint="Quanto custou, em média, cada lead que fechou um agendamento no período.">
          Custo por lead fechado
        </CardTitle>
        <Stat
          label="Custo por lead"
          value={summary.costPerLeadCents === null ? "—" : formatBRL(summary.costPerLeadCents)}
          hint={
            summary.costPerLeadCents === null
              ? "nenhum lead fechado no período"
              : `vs. ${formatBRL(summary.valuePerLeadCents ?? 0)} de valor por lead`
          }
        />
      </Card>
    </div>
  );
}
