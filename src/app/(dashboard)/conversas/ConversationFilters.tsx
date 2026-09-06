"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { ListFilter, TriangleAlert } from "lucide-react";
import { SelectMenu } from "@/components/ui/select-menu";
import { cn } from "@/lib/utils";
import { CONVERSA_STAGES } from "./leadStatus";

/**
 * Filtros da lista de conversas, em duas camadas.
 *
 * Eram sete pílulas na mesma fileira. Numa coluna de 19rem elas quebravam em
 * três linhas e comiam mais altura que a própria lista — mas o problema não era
 * só espaço: as sete tratavam como iguais duas coisas de pesos diferentes. Os
 * recortes da lista (estágio do lead, e "testes" por origem do dado) são
 * escolhas de o que ver; "Precisa de você" é urgência — o motivo de a pessoa
 * ter aberto a tela.
 *
 * Agora: o urgente vira um destaque acima (com contagem, e só quando existe) e
 * os recortes ficam num `SelectMenu`, com "Conversas de teste" separada por uma
 * linha das etapas do funil. Uma linha, e cada coisa com o peso que merece.
 *
 * Continua tudo por querystring — os filtros são navegação, não estado local.
 */
export function ConversationFilters({
  status,
  search,
  counts,
}: {
  status: string;
  search: string;
  counts: { all: number; needsHuman: number; test: number };
}) {
  const router = useRouter();

  const href = (key: string) =>
    `/conversas?status=${key}${search ? `&q=${encodeURIComponent(search)}` : ""}`;

  // "Precisa de você" é o único filtro fora do menu: quando ele está ativo o
  // menu volta para "Todas" em vez de mostrar um valor que ele não tem.
  const stageValue = CONVERSA_STAGES.some((s) => s.key === status)
    ? status
    : "all";
  const onNeedsHuman = status === "needs_human";

  return (
    <div className="space-y-2">
      {/*
        O alerta só existe quando há algo parado. Um "0 precisam de você"
        permanente é ruído: informa que não há nada a fazer, ocupando o lugar
        mais nobre da coluna.
      */}
      {(counts.needsHuman > 0 || onNeedsHuman) && (
        <Link
          href={onNeedsHuman ? href("all") : href("needs_human")}
          aria-current={onNeedsHuman ? "page" : undefined}
          className={cn(
            "flex items-center gap-2 rounded-control border px-3 py-2 text-sm transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris",
            onNeedsHuman
              ? "border-danger/60 bg-danger/15 text-white"
              : "border-danger/30 bg-danger/10 text-white/80 hover:bg-danger/15 hover:text-white",
          )}
        >
          <TriangleAlert
            size={15}
            aria-hidden
            className="shrink-0 text-danger"
          />
          <span className="min-w-0 flex-1">
            {counts.needsHuman === 0 ? (
              // Zerado E filtrado: em vez de sumir (deixando uma lista vazia
              // sem dizer por quê), vira a confirmação de que acabou.
              "Nada mais esperando por você"
            ) : (
              <>
                <strong className="font-display font-bold tabular-nums">
                  {counts.needsHuman}
                </strong>{" "}
                {counts.needsHuman === 1 ? "precisa" : "precisam"} de você
              </>
            )}
          </span>
          {onNeedsHuman && (
            <span className="shrink-0 font-mono text-micro uppercase tracking-wide text-white/60">
              limpar
            </span>
          )}
        </Link>
      )}

      {/* `SelectMenu` e não o `<select>` nativo: o menu nativo é desenhado
          pelo SO e abre claro sobre o painel escuro, ignorando a paleta. Em
          filtro (diferente de formulário) o menu é parte da tela. */}
      <SelectMenu
        size="sm"
        label="Filtrar conversas"
        icon={ListFilter}
        value={stageValue}
        onChange={(key) => router.push(href(key))}
        options={CONVERSA_STAGES.map((s) => ({
          value: s.key,
          label: s.label,
          dot: s.dot,
          separatorBefore: s.separatorBefore,
          // Contagem só onde ela informa algo que a lista não mostra: o total
          // e quantos testes existem. Por estágio seria uma consulta a mais
          // por item, para um número que a própria lista já revela ao filtrar.
          badge:
            s.key === "all"
              ? counts.all
              : s.key === "test"
                ? counts.test
                : undefined,
        }))}
      />
    </div>
  );
}
