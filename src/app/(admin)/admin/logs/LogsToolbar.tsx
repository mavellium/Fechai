"use client";

import { LogsFilters } from "./LogsFilters";
import { LogsSearch } from "./LogsSearch";
import type { LogFilterValues } from "./filter-url";

/**
 * Barra de ações da trilha: buscar, filtrar, escolher a janela de tempo e o
 * atalho de "só reversíveis" — tudo numa linha, como na lista de contas.
 *
 * Não há botão de criar aqui: ninguém cria um evento de auditoria à mão (é o
 * ponto da tabela). A barra fica com o mesmo esqueleto da de contas menos essa
 * ação, em vez de virar outro desenho por causa da diferença.
 *
 * O `items-end` alinha tudo pela base: a busca tem rótulo acima e os botões
 * não, então alinhar pelo topo deixaria os botões flutuando.
 */
export function LogsToolbar({ filters }: { filters: LogFilterValues }) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <LogsSearch values={filters} />

      {/* `LogsFilters` rende o botão "Filtrar", o período, o atalho de
          reversíveis e — numa faixa `w-full` — as etiquetas do que está
          filtrado. A ordem visual vem do `order-*`, não do DOM: as etiquetas
          quebram para a linha de baixo (ordem 3). */}
      <LogsFilters values={filters} />
    </div>
  );
}
