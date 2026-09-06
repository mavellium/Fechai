"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { SelectMenu } from "@/components/ui/select-menu";
import { AUDIT_GROUPS } from "@/modules/audit/events";
import { filtersToHref, type FieldKey, type LogFilterValues } from "./filter-url";

type Opt = { value: string; label: string; dot?: string };

/** Assunto do evento — vem do catálogo, nunca de uma lista paralela aqui. */
const GRUPOS: Opt[] = Object.entries(AUDIT_GROUPS).map(([value, label]) => ({ value, label }));

const AUTORES: Opt[] = [
  { value: "cliente", label: "Clientes", dot: "bg-iris" },
  { value: "admin", label: "Admin", dot: "bg-signal" },
  { value: "sistema", label: "Sistema", dot: "bg-white/30" },
];

/**
 * A natureza do evento (`kind`). É o recorte que responde "o que foi apagado
 * essa semana?" sem passar por assunto nenhum — a pergunta mais frequente
 * quando algo sumiu e ninguém sabe de qual tela veio.
 */
const TIPOS: Opt[] = [
  { value: "create", label: "Criações", dot: "bg-success" },
  { value: "update", label: "Alterações", dot: "bg-iris" },
  { value: "delete", label: "Exclusões", dot: "bg-danger" },
  { value: "auth", label: "Entradas", dot: "bg-white/30" },
  { value: "access", label: "Acessos", dot: "bg-warn" },
];

const PERIODO = [
  { value: "1", label: "24 horas" },
  { value: "7", label: "7 dias" },
  { value: "30", label: "30 dias" },
  { value: "90", label: "90 dias" },
  { value: "365", label: "1 ano" },
];

const FIELDS = [
  { key: "grupo", label: "Assunto", options: GRUPOS },
  { key: "autor", label: "Quem fez", options: AUTORES },
  { key: "tipo", label: "Natureza do evento", options: TIPOS },
] as const;

const LABEL_OF: Record<string, Record<string, string>> = Object.fromEntries(
  FIELDS.map((f) => [f.key, Object.fromEntries(f.options.map((o) => [o.value, o.label]))]),
);

/**
 * Filtros da trilha: um botão que abre o modal, e o que está filtrado como
 * etiquetas ao lado — o mesmo padrão da lista de contas, de propósito.
 *
 * As duas telas do admin são listas grandes com recorte por vários campos, e
 * quem usa uma usa a outra no mesmo dia. Um segundo desenho de filtro aqui
 * (selects soltos numa barra) obrigaria a reaprender a mesma tarefa por
 * capricho de tela.
 *
 * Dentro do mesmo campo os valores são OU ("admin OU sistema"); entre campos, E.
 * O `draft` é só o que está sendo mexido no modal — nada muda a lista antes de
 * "Aplicar", senão a página recarregaria a cada clique.
 */
export function LogsFilters({ values }: { values: LogFilterValues }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(values);

  function push(next: LogFilterValues) {
    router.push(filtersToHref(next));
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

  // Dois "limpar" diferentes, como nas contas: o de dentro do modal zera o
  // RASCUNHO (e ainda precisa de "Aplicar"); o de fora zera o que já está
  // VALENDO. Um objeto só faria o botão de fora publicar rascunho não aplicado.
  const clearedDraft = { ...draft, grupo: [], autor: [], tipo: [] };
  const clearedApplied = {
    ...values,
    grupo: [],
    autor: [],
    tipo: [],
    pendentes: false,
    conta: "",
  };

  const chips = [
    ...FIELDS.flatMap((f) =>
      values[f.key].map((v) => ({
        key: `${f.key}-${v}`,
        label: LABEL_OF[f.key][v] ?? v,
        remove: () => removeChip(f.key, v),
      })),
    ),
    // "Só reversíveis" e o recorte por conta também são filtros ativos: se não
    // virassem etiqueta, a lista viria recortada sem nada na tela dizendo por quê.
    ...(values.pendentes
      ? [
          {
            key: "pendentes",
            label: "Só reversíveis",
            remove: () => push({ ...values, pendentes: false }),
          },
        ]
      : []),
    ...(values.conta
      ? [
          {
            key: "conta",
            label: "Uma conta",
            remove: () => push({ ...values, conta: "" }),
          },
        ]
      : []),
  ];

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

      {/* A janela de tempo fica FORA do modal, ao lado da ordenação das contas.
          Não é um recorte a mais: toda consulta à trilha tem uma, e escondê-la
          atrás do "Filtrar" faria a lista parecer completa quando é dos
          últimos 30 dias. */}
      <SelectMenu
        label="Período dos eventos"
        value={String(values.dias)}
        onChange={(dias) => push({ ...values, dias: Number(dias) })}
        className="order-1 w-40"
        options={PERIODO}
      />

      {/* Atalho para o que o admin procura quando algo deu errado: o que ainda
          dá para desfazer. Vale um botão próprio porque é a razão nº 1 de
          abrir esta tela com pressa. */}
      <Button
        variant={values.pendentes ? "default" : "outline"}
        className="order-1"
        aria-pressed={values.pendentes}
        onClick={() => push({ ...values, pendentes: !values.pendentes })}
      >
        Só reversíveis
      </Button>

      {/* Os filtros ativos à vista, fora do modal: um botão marcando "3" não
          diz QUAIS três. Cada um sai com um clique no ×. */}
      {chips.length > 0 && (
        <div className="order-3 flex w-full flex-wrap items-center gap-2">
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={c.remove}
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
        title="Filtrar eventos"
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
                    deixa de exigir abrir o menu e caçar a linha certa. */}
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
                  placeholder="Todos"
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
