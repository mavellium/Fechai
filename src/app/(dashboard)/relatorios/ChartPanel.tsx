"use client";

import { Card, CardTitle } from "@/components/ui/card";
import { ChartActions } from "@/components/charts/ChartActions";
import { ChartTable } from "@/components/charts/ChartTable";
import type { AiHumanPoint, FlowPoint, ResultPoint } from "@/modules/reports/service";
import { BarsChart } from "./BarsChart";
import { DonutChart } from "./DonutChart";
import { FlowChart } from "./FlowChart";
import { SeriesChart } from "./SeriesChart";

type Variant = "flow" | "results" | "donut" | "attendance" | "closed";

const DESCRIPTIONS: Record<Variant, string> = {
  flow: "Mensagens gravadas em conversas reais (o sandbox de teste não conta). Recebidas são mensagens do cliente (role user); enviadas são respostas do agente e mensagens manuais do painel (role assistant). Contadas pela data em que foram gravadas.",
  results: "Leads novos são contatos criados no período, sem o sandbox. Agendamentos são horários com status marcado ou concluído que começam no período.",
  donut: "Conversas com atividade no período, agrupadas pelo agente que as atendeu. Conversas sem agente vinculado aparecem como 'Sem agente'.",
  attendance: "Contatos que o agente respondeu sozinho (resposta automática) contra contatos em que um humano respondeu pelo painel. Um contato atendido pela IA e pelo humano no mesmo período entra só em 'Precisou de humano'. O sandbox de teste não conta.",
  closed: "Leads que fecharam um horário (status 'Agendado'), divididos por quem marcou: a IA, pela ferramenta de agendamento durante a conversa, ou o dono, manualmente no painel. O sandbox de teste não conta.",
};

/**
 * Card de gráfico do relatório. As ações "Ampliar" e "Como é calculado" vêm do
 * `ChartActions` compartilhado (ver `src/components/charts/ChartActions.tsx`).
 */
export function ChartPanel({
  title,
  hint,
  variant,
  flow,
  results,
  slices,
  attendance,
  closed,
}: {
  title: string;
  hint: string;
  variant: Variant;
  flow?: FlowPoint[];
  results?: ResultPoint[];
  slices?: { name: string; count: number }[];
  attendance?: AiHumanPoint[];
  closed?: AiHumanPoint[];
}) {
  const chart = (tall: boolean) => {
    switch (variant) {
      case "flow":
        return <FlowChart points={flow ?? []} className={tall ? "h-64" : undefined} />;
      case "results":
        return <BarsChart points={results ?? []} className={tall ? "h-64" : undefined} />;
      case "donut":
        return <DonutChart slices={slices ?? []} className={tall ? "h-48 w-48" : undefined} />;
      case "attendance":
        return (
          <SeriesChart
            points={(attendance ?? []).map((p) => ({ key: p.key, label: p.label, a: p.ai, b: p.human }))}
            labelA="Só IA"
            labelB="Precisou de humano"
            colorA="text-success"
            colorB="text-warn"
            empty="Nenhuma conversa com resposta no período."
            className={tall ? "h-64" : undefined}
          />
        );
      case "closed":
        return (
          <SeriesChart
            points={(closed ?? []).map((p) => ({ key: p.key, label: p.label, a: p.ai, b: p.human }))}
            labelA="IA"
            labelB="Humano"
            colorA="text-iris"
            colorB="text-success"
            empty="Nenhum agendamento no período."
            className={tall ? "h-64" : undefined}
          />
        );
    }
  };

  // Tabela completa do gráfico + totais (o "mais informações" da tela cheia).
  const table = (() => {
    if (variant === "flow") {
      const points = flow ?? [];
      const tIn = points.reduce((s, p) => s + p.inbound, 0);
      const tOut = points.reduce((s, p) => s + p.outbound, 0);
      return {
        head: ["Período", "Recebidas", "Enviadas"],
        rows: points.map((p) => [p.label, String(p.inbound), String(p.outbound)]),
        foot: ["Total", String(tIn), String(tOut)],
      };
    }
    if (variant === "results") {
      const points = results ?? [];
      const tL = points.reduce((s, p) => s + p.leads, 0);
      const tA = points.reduce((s, p) => s + p.appts, 0);
      return {
        head: ["Período", "Leads novos", "Agendamentos"],
        rows: points.map((p) => [p.label, String(p.leads), String(p.appts)]),
        foot: ["Total", String(tL), String(tA)],
      };
    }
    if (variant === "attendance") {
      const points = attendance ?? [];
      const tAi = points.reduce((s, p) => s + p.ai, 0);
      const tHuman = points.reduce((s, p) => s + p.human, 0);
      return {
        head: ["Período", "Só IA", "Precisou de humano"],
        rows: points.map((p) => [p.label, String(p.ai), String(p.human)]),
        foot: ["Total", String(tAi), String(tHuman)],
      };
    }
    if (variant === "closed") {
      const points = closed ?? [];
      const tAi = points.reduce((s, p) => s + p.ai, 0);
      const tHuman = points.reduce((s, p) => s + p.human, 0);
      return {
        head: ["Período", "IA", "Humano"],
        rows: points.map((p) => [p.label, String(p.ai), String(p.human)]),
        foot: ["Total", String(tAi), String(tHuman)],
      };
    }
    const parts = slices ?? [];
    const total = parts.reduce((s, x) => s + x.count, 0);
    return {
      head: ["Agente", "Conversas", "Participação"],
      rows: parts.map((s) => [s.name, String(s.count), `${Math.round((s.count / total) * 100)}%`]),
      foot: ["Total", String(total), "100%"],
    };
  })();

  // Origem dos dados: o que compõe o resultado (a tabela resumo do diálogo).
  const sources: [string, string][] = (() => {
    if (variant === "flow") {
      const points = flow ?? [];
      return [
        ["Mensagens recebidas do cliente", String(points.reduce((s, p) => s + p.inbound, 0))],
        ["Mensagens enviadas (agente + painel)", String(points.reduce((s, p) => s + p.outbound, 0))],
        ["Período coberto", `${points[0]?.label ?? "—"} a ${points[points.length - 1]?.label ?? "—"}`],
        ["Testes (sandbox)", "excluídos"],
      ];
    }
    if (variant === "results") {
      const points = results ?? [];
      return [
        ["Leads novos", String(points.reduce((s, p) => s + p.leads, 0))],
        ["Agendamentos", String(points.reduce((s, p) => s + p.appts, 0))],
        ["Período coberto", `${points[0]?.label ?? "—"} a ${points[points.length - 1]?.label ?? "—"}`],
        ["Testes (sandbox)", "excluídos"],
      ];
    }
    if (variant === "attendance") {
      const points = attendance ?? [];
      return [
        ["Contatos só com resposta da IA", String(points.reduce((s, p) => s + p.ai, 0))],
        ["Contatos com resposta humana", String(points.reduce((s, p) => s + p.human, 0))],
        ["Período coberto", `${points[0]?.label ?? "—"} a ${points[points.length - 1]?.label ?? "—"}`],
        ["Testes (sandbox)", "excluídos"],
      ];
    }
    const points = closed ?? [];
    return [
      ["Agendamentos fechados pela IA", String(points.reduce((s, p) => s + p.ai, 0))],
      ["Agendamentos fechados manualmente", String(points.reduce((s, p) => s + p.human, 0))],
      ["Período coberto", `${points[0]?.label ?? "—"} a ${points[points.length - 1]?.label ?? "—"}`],
      ["Testes (sandbox)", "excluídos"],
    ];
  })();

  return (
    <Card>
      <CardTitle
        hint={hint}
        action={
          <ChartActions
            label={title}
            title={title}
            hint={hint}
            description={DESCRIPTIONS[variant]}
            sources={sources}
            full={
              <>
                {chart(true)}
                <ChartTable head={table.head} rows={table.rows} foot={table.foot} />
              </>
            }
          />
        }
      >
        {title}
      </CardTitle>

      {chart(false)}
    </Card>
  );
}
