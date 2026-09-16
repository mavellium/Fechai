import Link from "next/link";
import { shortAge } from "@/lib/format";
import { leadStatusLabel } from "./leadStatus";
import { DeleteTestConversationButton } from "./DeleteTestConversationButton";

export type ConversationListItem = {
  id: string;
  needsHuman: boolean;
  agentPaused: boolean;
  isTest: boolean;
  updatedAt: Date;
  lead: { name: string | null; phone: string; status: string };
  preview: string | null;
};

const DAY = 86_400_000;

/**
 * Agrupa por urgência e depois por recência.
 *
 * Ordenar só por `updatedAt` fazia do filtro "precisa de você" a única forma de
 * achar o que importa — e quem não conhecia o filtro nunca via a fila. Aqui o
 * que espera atendimento sobe sozinho, sem esconder o resto.
 */
function group(items: ConversationListItem[], now: Date) {
  const buckets: { label: string; items: ConversationListItem[] }[] = [
    { label: "Precisam de você", items: [] },
    { label: "Hoje", items: [] },
    { label: "Últimos 7 dias", items: [] },
    { label: "Antes", items: [] },
  ];

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  for (const item of items) {
    const t = item.updatedAt.getTime();
    if (item.needsHuman) buckets[0].items.push(item);
    else if (t >= startOfToday) buckets[1].items.push(item);
    else if (t >= startOfToday - 6 * DAY) buckets[2].items.push(item);
    else buckets[3].items.push(item);
  }

  return buckets.filter((b) => b.items.length > 0);
}

/** Cor do estágio do lead, a mesma do ponto no seletor de filtros. */
const STATUS_DOT: Record<string, string> = {
  neutral: "bg-neutral panel:bg-white/40",
  iris: "bg-iris",
  warn: "bg-warn",
  success: "bg-success",
  danger: "bg-danger",
};

function Item({
  item,
  href,
  active,
}: {
  item: ConversationListItem;
  href: string;
  active: boolean;
}) {
  const status = leadStatusLabel(item.lead.status);
  const name = item.lead.name ?? item.lead.phone;

  // A linha tem duas alturas de informação, não três: quem é + o que disse.
  // O estágio do lead virou o ponto colado ao nome (mesma cor do filtro, sem
  // ocupar linha), e "precisa de você" virou a faixa na borda esquerda — os
  // dois estados que restam são excludentes na prática e cabem num rótulo só.
  const flag = item.needsHuman
    ? { text: "precisa de você", color: "text-danger", bar: "bg-danger" }
    : item.agentPaused
      ? { text: "agente pausado", color: "text-warn", bar: "bg-warn" }
      : null;

  return (
    <li className="group/item relative">
      <Link
        href={href}
        aria-current={active ? "true" : undefined}
        className={`flex gap-2.5 rounded-surface py-2 pl-3 pr-9 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris ${
          active ? "bg-iris/20" : "hover:bg-white/5"
        }`}
      >
        {/* Faixa na borda: sinaliza urgência sem consumir largura de texto. */}
        {flag && (
          <span
            aria-hidden
            className={`absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full ${flag.bar}`}
          />
        )}

        <span
          aria-hidden
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 font-display text-xs font-semibold uppercase text-white/70"
        >
          {name.slice(0, 1)}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-1.5">
            {/* Ponto do estágio: cor + nome acessível, nunca cor sozinha. */}
            <span
              aria-hidden
              className={`h-1.5 w-1.5 shrink-0 self-center rounded-full ${
                item.isTest ? "bg-white/25" : STATUS_DOT[status.tone] ?? STATUS_DOT.neutral
              }`}
            />
            <span className="sr-only">{item.isTest ? "Conversa de teste" : status.label}. </span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-white">{name}</span>
            <time
              dateTime={item.updatedAt.toISOString()}
              className="shrink-0 font-mono text-micro text-white/45"
            >
              {shortAge(item.updatedAt)}
            </time>
          </span>

          <span className="mt-0.5 flex items-baseline gap-1.5 pl-3">
            <span className="min-w-0 flex-1 truncate text-xs text-white/55">
              {item.preview ?? "Sem mensagens"}
            </span>
            {/* Texto puro no lugar da pílula: mesma informação, sem a caixa. */}
            {flag && (
              <span className={`shrink-0 font-mono text-micro uppercase tracking-wide ${flag.color}`}>
                {flag.text}
              </span>
            )}
          </span>
        </span>
      </Link>

      {item.isTest && (
        <span className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover/item:opacity-100 focus-within:opacity-100">
          <DeleteTestConversationButton conversationId={item.id} iconOnly />
        </span>
      )}
    </li>
  );
}

export function ConversationList({
  items,
  selectedId,
  hrefFor,
  moreHref,
  now = new Date(),
}: {
  items: ConversationListItem[];
  selectedId?: string;
  hrefFor: (id: string) => string;
  /** URL que carrega o próximo lote, ou `null` quando a lista acabou. */
  moreHref: string | null;
  now?: Date;
}) {
  const groups = group(items, now);

  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <section key={g.label}>
          <h3 className="px-3 pb-1 font-mono text-micro uppercase tracking-[0.15em] text-white/45">
            {g.label}
            <span className="ml-2 tabular-nums opacity-70">{g.items.length}</span>
          </h3>
          <ul className="space-y-0.5">
            {g.items.map((item) => (
              <Item
                key={item.id}
                item={item}
                href={hrefFor(item.id)}
                active={item.id === selectedId}
              />
            ))}
          </ul>
        </section>
      ))}

      {moreHref && (
        <Link
          href={moreHref}
          scroll={false}
          className="block rounded-surface border border-white/10 px-3 py-2 text-center font-mono text-micro uppercase tracking-wide text-white/60 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
        >
          Carregar mais
        </Link>
      )}
    </div>
  );
}
