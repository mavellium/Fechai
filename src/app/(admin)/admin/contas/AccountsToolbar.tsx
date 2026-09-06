"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NewAccountForm } from "./NewAccountForm";
import { AccountsFilters } from "./AccountsFilters";
import { AccountsSearch } from "./AccountsSearch";
import type { TenantFilterValues } from "./filter-url";

/**
 * Barra de ações da lista de contas: buscar, filtrar, ordenar, escolher quantas
 * linhas trazer e criar — tudo numa linha.
 *
 * Cada um desses controles nasceu numa linha própria, empilhados, empurrando a
 * tabela para baixo. São as ações da mesma tela e sobre a mesma lista: separadas
 * em três faixas, pareciam três assuntos.
 *
 * O `items-end` alinha tudo pela base: a busca tem rótulo acima e os botões
 * não, então alinhar pelo topo deixaria os botões flutuando.
 */
export function AccountsToolbar({
  filters,
  pageSizes,
  defaultLimit,
}: {
  filters: TenantFilterValues;
  pageSizes: readonly number[];
  defaultLimit: number;
}) {
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex flex-wrap items-end gap-3">
      {/* A busca filtra sozinha enquanto se digita — daí não haver mais um
          `<form>` aqui, nem os campos ocultos que carregavam os filtros pelo
          envio: o endereço é montado inteiro a partir do que está valendo. */}
      <AccountsSearch values={filters} defaultLimit={defaultLimit} />

      {/* `AccountsFilters` rende quatro coisas: o botão "Filtrar", a ordenação,
          a quantidade por página e — numa faixa `w-full` — as etiquetas do que
          está filtrado. A ordem visual vem do `order-*`, não do DOM: "Nova
          conta" fecha a primeira linha (ordem 2) e as etiquetas quebram para a
          de baixo (ordem 3). */}
      <AccountsFilters values={filters} pageSizes={pageSizes} defaultLimit={defaultLimit} />

      <Button type="button" className="order-2 ml-auto" onClick={() => setCreating(true)}>
        <Plus size={15} aria-hidden />
        Nova conta
      </Button>

      <NewAccountForm open={creating} onOpenChange={setCreating} />
    </div>
  );
}
