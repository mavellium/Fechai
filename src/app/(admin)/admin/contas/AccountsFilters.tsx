"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { SelectMenu } from "@/components/ui/select-menu";
import { filtersToHref, type FieldKey, type TenantFilterValues } from "./filter-url";

type Opt = { value: string; label: string; dot?: string };

const STATUS: Opt[] = [
  { value: "active", label: "Ativas", dot: "bg-success" },
  { value: "suspended", label: "Suspensas", dot: "bg-danger" },
];

const PLANS: Opt[] = [
  { value: "FREE", label: "Grátis" },
  { value: "STARTER", label: "Starter" },
  { value: "PRO", label: "Pro" },
  { value: "BUSINESS", label: "Business" },
];

const WHATSAPP: Opt[] = [
  { value: "connected", label: "Conectado", dot: "bg-success" },
  { value: "pending_qr", label: "Aguardando QR", dot: "bg-warn" },
  { value: "disconnected", label: "Desconectado", dot: "bg-white/30" },
  { value: "none", label: "Nunca conectou" },
];

const TRIAL: Opt[] = [
  { value: "ativo", label: "Em teste agora" },
  { value: "expirado", label: "Teste expirado" },
  { value: "sem", label: "Sem teste" },
];

const SORT = [
  { value: "recentes", label: "Mais recentes" },
  { value: "antigas", label: "Mais antigas" },
  { value: "nome", label: "Nome (A-Z)" },
  { value: "leads", label: "Mais leads" },
  { value: "conversas", label: "Mais conversas" },
];

const FIELDS = [
  { key: "status", label: "Situação da conta", options: STATUS },
  { key: "plan", label: "Plano", options: PLANS },
  { key: "whatsapp", label: "WhatsApp", options: WHATSAPP },
  { key: "trial", label: "Período de teste", options: TRIAL },
] as const;

const LABEL_OF: Record<string, Record<string, string>> = Object.fromEntries(
  FIELDS.map((f) => [f.key, Object.fromEntries(f.options.map((o) => [o.value, o.label]))]),
);

/**
 * Filtros da lista de contas: um botão que abre o modal, e o que está filtrado
 * como etiquetas ao lado.
 *
 * Dentro do modal cada campo é um menu de seleção múltipla, com os valores já
 * escolhidos como etiquetas ACIMA dele. O menu é por onde se adiciona; a
 * etiqueta, por onde se tira — antes remover um valor exigia abrir o menu e
 * caçar a linha certa para desmarcá-la.
 *
 * Cada campo aceita mais de um valor porque a pergunta real costuma ser composta
 * ("no Free OU no Starter"). Dentro do mesmo campo os valores são OU; entre
 * campos, E.
 *
 * O estado vive na URL: sobrevive ao recarregar, volta no histórico e pode ser
 * enviado por link. O `draft` é só o que está sendo mexido no modal — nada muda
 * a lista antes de "Aplicar", senão a página recarregaria a cada clique.
 */
export function AccountsFilters({
  values,
  pageSizes,
  defaultLimit,
}: {
  values: TenantFilterValues;
  pageSizes: readonly number[];
  defaultLimit: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(values);

  function push(next: TenantFilterValues) {
    router.push(filtersToHref(next, defaultLimit));
  }

  function toggle(field: FieldKey, value: string) {
    setDraft((d) => {
      const on = d[field].includes(value);
      return { ...d, [field]: on ? d[field].filter((v) => v !== value) : [...d[field], value] };
    });
  }

  function removeChip(field: FieldKey, value: string) {
    const next = { ...values, [field]: values[field].filter((v) => v !== value) };
    setDraft(next);
    push(next);
  }

  // Dois "limpar" diferentes: o de dentro do modal zera o RASCUNHO (e ainda
  // precisa de "Aplicar"); o de fora zera o que já está VALENDO. Um objeto só,
  // derivado do draft, faria o botão de fora publicar um rascunho não aplicado.
  const clearedDraft = { ...draft, status: [], plan: [], whatsapp: [], trial: [] };
  const clearedApplied = { ...values, status: [], plan: [], whatsapp: [], trial: [] };
  const chips = FIELDS.flatMap((f) =>
    values[f.key].map((v) => ({
      field: f.key,
      value: v,
      label: LABEL_OF[f.key][v] ?? v,
    })),
  );
  const draftCount = FIELDS.reduce((n, f) => n + draft[f.key].length, 0);

  return (
    <>
      <Button
        variant="outline"
        className="order-1"
        onClick={() => {
          // Abre sempre a partir do que está valendo — um rascunho abandonado
          // numa visita anterior reapareceria como se fosse o filtro atual.
          setDraft(values);
          setOpen(true);
        }}
      >
        <SlidersHorizontal size={15} aria-hidden />
        Filtrar
        {chips.length > 0 && (
          <span className="rounded-full bg-iris px-1.5 font-mono text-micro tabular-nums text-white">
            {chips.length}
          </span>
        )}
      </Button>

      <SelectMenu
        label="Ordenar contas"
        value={values.sort || "recentes"}
        onChange={(sort) => push({ ...values, sort })}
        className="order-1 w-44"
        options={SORT}
      />

      {/* Quantas linhas carregar. A lista sempre teve um teto (era 200, fixo no
          código); a diferença é que agora ele está à vista e quem só quer olhar
          as últimas contas pode pedir 20 em vez de esperar 200.

          Só o número aparece — ao lado de "Mais recentes", "20" já se lê como
          quantidade sem repetir "por página" quatro vezes. O sentido continua
          dito para quem não vê a barra: é o `label`, que vira o nome acessível
          do controle. */}
      <SelectMenu
        label="Quantidade de contas por página"
        value={String(values.limite)}
        onChange={(limite) => push({ ...values, limite: Number(limite) })}
        className="order-1 w-24"
        options={pageSizes.map((n) => ({ value: String(n), label: String(n) }))}
      />

      {/* Os filtros ativos à vista, fora do modal: um botão marcando "3" não diz
          QUAIS três, e obrigaria a reabrir só para lembrar. Cada um sai com um
          clique no ×, sem passar pelo modal. */}
      {chips.length > 0 && (
        <div className="order-3 flex w-full flex-wrap items-center gap-2">
          {chips.map((c) => (
            <button
              key={`${c.field}-${c.value}`}
              type="button"
              onClick={() => removeChip(c.field, c.value)}
              aria-label={`Remover filtro ${c.label}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-iris/40 bg-iris/15 py-1 pl-3 pr-2 text-sm text-white transition-colors hover:border-iris/60 hover:bg-iris/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
            >
              {c.label}
              <X size={13} aria-hidden className="text-white/60" />
            </button>
          ))}
          {chips.length > 1 && (
            <Button size="sm" variant="ghost" onClick={() => push(clearedApplied)}>
              Limpar tudo
            </Button>
          )}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Filtrar contas"
        description="Dentro de um campo, vale qualquer um dos marcados. Entre campos, todos."
        size="wide"
      >
        <div className="space-y-6">
          {FIELDS.map((f) => {
            const chosen = draft[f.key];
            return (
              <div key={f.key}>
                <p className="mb-2 text-sm font-medium text-white/85">{f.label}</p>

                {/* Os escolhidos acima do menu, cada um com ×: tirar um valor
                    deixa de exigir abrir o menu e caçar a linha certa. O menu
                    continua sendo por onde se ADICIONA. */}
                {chosen.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {chosen.map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => toggle(f.key, v)}
                        aria-label={`Remover ${LABEL_OF[f.key][v] ?? v} de ${f.label}`}
                        className="inline-flex items-center gap-1.5 rounded-full border border-iris/40 bg-iris/15 py-1 pl-3 pr-2 text-sm text-white transition-colors hover:border-iris/60 hover:bg-iris/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
                      >
                        {LABEL_OF[f.key][v] ?? v}
                        <X size={13} aria-hidden className="text-white/60" />
                      </button>
                    ))}
                  </div>
                )}

                <SelectMenu
                  multiple
                  label={f.label}
                  value={chosen}
                  onChange={(next) => setDraft((d) => ({ ...d, [f.key]: next }))}
                  placeholder="Todas"
                  options={f.options}
                />
              </div>
            );
          })}

          <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-5">
            <Button
              variant="ghost"
              size="sm"
              disabled={draftCount === 0}
              onClick={() => setDraft(clearedDraft)}
            >
              Limpar
            </Button>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button
                onClick={() => {
                  push(draft);
                  setOpen(false);
                }}
              >
                Aplicar{draftCount > 0 ? ` (${draftCount})` : ""}
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}
