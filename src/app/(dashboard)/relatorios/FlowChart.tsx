"use client";

import type { FlowPoint } from "@/modules/reports/service";
import { SeriesChart } from "./SeriesChart";

/**
 * Evolução do fluxo de mensagens (recebidas × enviadas) no período. Wrapper de
 * `SeriesChart` — traduz o `FlowPoint` do relatório (inbound/outbound) para as
 * duas séries do gráfico genérico.
 */
export function FlowChart({
  points,
  className,
}: {
  points: FlowPoint[];
  /** Altura do desenho — o padrão é compacto no card; tela cheia passa maior. */
  className?: string;
}) {
  return (
    <SeriesChart
      points={points.map((p) => ({ key: p.key, label: p.label, a: p.inbound, b: p.outbound }))}
      labelA="Recebidas"
      labelB="Enviadas"
      colorA="text-success"
      colorB="text-neutral"
      empty="Nenhuma mensagem no período."
      className={className}
    />
  );
}
