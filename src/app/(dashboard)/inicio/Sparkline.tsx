const WEEKDAY = new Intl.DateTimeFormat("pt-BR", { weekday: "short" });
const SHORT_DATE = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" });

/**
 * Barras finas de volume por dia. Sem biblioteca de gráfico: são divs com
 * altura proporcional — o dado é uma série curta de inteiros e não justifica
 * trazer um runtime de charts para o painel.
 *
 * `role="img"` + `aria-label` com o resumo: quem usa leitor de tela recebe o
 * total e o pico, que é o que as barras comunicam, sem ouvir 30 números.
 */
export function Sparkline({
  data,
  label,
}: {
  data: { day: Date; count: number }[];
  label: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const total = data.reduce((sum, d) => sum + d.count, 0);
  const peak = data.reduce((best, d) => (d.count > best.count ? d : best), data[0]);

  const summary =
    total === 0
      ? `${label}: nenhuma no período.`
      : `${label}: ${total} no total, com pico de ${peak.count} em ${SHORT_DATE.format(peak.day)}.`;

  return (
    <figure className="mt-4">
      <div role="img" aria-label={summary} className="flex h-16 items-end gap-1">
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
      <figcaption className="mt-2 flex justify-between font-mono text-micro uppercase tracking-wide text-white/40">
        <span>{data.length <= 7 ? WEEKDAY.format(data[0].day) : SHORT_DATE.format(data[0].day)}</span>
        <span>{label}</span>
        <span>hoje</span>
      </figcaption>
    </figure>
  );
}
