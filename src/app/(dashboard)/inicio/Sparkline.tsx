"use client";

import { ChartActions } from "@/components/charts/ChartActions";
import { ChartTable } from "@/components/charts/ChartTable";
import { cn } from "@/lib/utils";

const WEEKDAY = new Intl.DateTimeFormat("pt-BR", { weekday: "short" });
const SHORT_DATE = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" });

/**
 * Barras finas de volume por dia. Sem biblioteca de gráfico: são divs com
 * altura proporcional — o dado é uma série curta de inteiros e não justifica
 * trazer um runtime de charts para o painel.
 *
 * `role="img"` + `aria-label` com o resumo: quem usa leitor de tela recebe o
 * total e o pico, que é o que as barras comunicam, sem ouvir 30 números.
 *
 * Traz as ações "Ampliar" e "Como é calculado" do `ChartActions` compartilhado
 * num micro-cabeçalho próprio — o gráfico fica abaixo dos stats do card e não
 * tem título de card para abrigar as ações.
 */
export function Sparkline({
  data,
  label,
  className,
}: {
  data: { day: Date; count: number }[];
  label: string;
  /** Altura das barras — o padrão é compacto no card; tela cheia passa maior. */
  className?: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const total = data.reduce((sum, d) => sum + d.count, 0);
  const peak = data.reduce((best, d) => (d.count > best.count ? d : best), data[0]);

  const summary =
    total === 0
      ? `${label}: nenhuma no período.`
      : `${label}: ${total} no total, com pico de ${peak.count} em ${SHORT_DATE.format(peak.day)}.`;

  const bars = (tall: boolean) => (
    <div role="img" aria-label={summary} className={cn("flex items-end gap-1", tall ? "h-64" : className ?? "h-16")}>
      {data.map((d) => (
        <div
          key={d.day.toISOString()}
          title={`${SHORT_DATE.format(d.day)}: ${d.count}`}
          className="flex-1 rounded-t-sm bg-iris/70"
          // altura mínima visível para o dia zerado não sumir da série
          style={{ height: `${Math.max(4, (d.count / max) * 100)}%` }}
        />
      ))}
    </div>
  );

  const title = label[0].toUpperCase() + label.slice(1);

  return (
    <figure className={className}>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <span className="font-mono text-micro uppercase tracking-wide text-neutral panel:text-white/55">
          {label}
        </span>
        <ChartActions
          label={label}
          title={title}
          hint={
            total === 0
              ? "Nenhuma mensagem no período."
              : `${total} mensagens, com pico de ${peak.count} em ${SHORT_DATE.format(peak.day)}.`
          }
          description="Mensagens recebidas por dia (role user) em conversas reais — o chat de teste do sandbox não conta. Contadas pela data em que foram gravadas."
          sources={[
            ["Mensagens recebidas no período", String(total)],
            ["Pico diário", total === 0 ? "—" : `${peak.count} em ${SHORT_DATE.format(peak.day)}`],
            ["Testes (sandbox)", "excluídos"],
          ]}
          full={
            <>
              {bars(true)}
              <ChartTable
                head={["Dia", "Mensagens"]}
                rows={data.map((d) => [SHORT_DATE.format(d.day), String(d.count)])}
                foot={["Total", String(total)]}
              />
            </>
          }
        />
      </div>

      {bars(false)}

      <figcaption className="mt-2 flex justify-between font-mono text-micro uppercase tracking-wide text-white/40">
        <span>{data.length <= 7 ? WEEKDAY.format(data[0].day) : SHORT_DATE.format(data[0].day)}</span>
        <span>hoje</span>
      </figcaption>
    </figure>
  );
}
