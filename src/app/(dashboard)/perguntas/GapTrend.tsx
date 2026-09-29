import type { GapStats } from "@/modules/knowledge-gaps/queue";
import { Card, CardTitle } from "@/components/ui/card";

/**
 * Perguntas sem resposta por mês — a tendência que tem que cair conforme a
 * equipe ensina o agente. Barras em HTML, como os gráficos de /relatorios.
 * O mês corrente fica marcado como parcial: comparar um mês pela metade com
 * um mês inteiro faria toda tela do dia 5 parecer uma vitória.
 */
export function GapTrend({ months }: { months: GapStats["months"] }) {
  const max = Math.max(1, ...months.map((m) => m.count));
  const complete = months.slice(0, -1);
  const [before, last] = complete.slice(-2);
  const change = before && last ? last.count - before.count : null;
  const total = months.reduce((sum, m) => sum + m.count, 0);

  return (
    <Card>
      <CardTitle hint="Mesma contagem do relatório mensal: cada vez que o agente registrou que não sabia responder.">
        Perguntas sem resposta por mês
      </CardTitle>
      {total === 0 ? (
        <p className="py-6 text-center text-sm text-neutral panel:text-white/55">
          Nenhuma pergunta sem resposta registrada nos últimos seis meses.
        </p>
      ) : (
        <>
          <ol className="flex h-32 items-end gap-3" aria-label="Perguntas sem resposta nos últimos seis meses">
            {months.map((m, i) => {
              const partial = i === months.length - 1;
              return (
                <li key={m.key} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                  <span className="font-mono text-xs tabular-nums text-ink panel:text-white/80">{m.count}</span>
                  <span
                    aria-hidden
                    className={partial ? "w-full max-w-10 rounded-t-sm border border-dashed border-iris/60 bg-iris/15" : "w-full max-w-10 rounded-t-sm bg-iris"}
                    style={{ height: m.count ? `${Math.max(4, (m.count / max) * 100)}%` : "1px" }}
                  />
                  <span className="font-mono text-micro uppercase tracking-wide text-neutral panel:text-white/55">
                    {m.label}
                    <span className="sr-only">: {m.count}{partial ? " (mês em andamento)" : ""}</span>
                  </span>
                </li>
              );
            })}
          </ol>
          <p className="mt-4 text-sm text-neutral panel:text-white/60">
            {change === null
              ? "O mês atual está em andamento."
              : change < 0
                ? `Queda de ${Math.abs(change)} em ${last.label} em relação a ${before.label}. O mês atual está em andamento.`
                : change > 0
                  ? `Alta de ${change} em ${last.label} em relação a ${before.label}. O mês atual está em andamento.`
                  : `Estável entre ${before.label} e ${last.label}. O mês atual está em andamento.`}
          </p>
        </>
      )}
    </Card>
  );
}
