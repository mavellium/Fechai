"use client";

import { useId, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./button";
import { SelectMenu } from "./select-menu";
import { useUnsavedNavigation } from "./unsaved-changes";

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

export function monthLabel(month: string) {
  const [year, index] = month.split("-").map(Number);
  return `${MONTHS[index - 1]} de ${year}`;
}

/** Navegação de competência com os menus do produto; meses publicados podem limitar a lista. */
export function MonthPicker({ value, href, availableMonths }: {
  value: string;
  /** Caminho local, com os filtros que devem ser preservados. */
  href: string;
  availableMonths?: string[];
}) {
  const router = useRouter();
  const confirmNavigation = useUnsavedNavigation();
  const [pending, start] = useTransition();
  const id = useId();
  const [year, month] = value.split("-").map(Number);
  const available = availableMonths ? [...availableMonths].sort() : null;
  const position = available?.indexOf(value) ?? -1;
  const shift = (offset: number) => {
    const date = new Date(Date.UTC(year, month - 1 + offset, 1));
    return date.toISOString().slice(0, 7);
  };
  const previous = available ? available[position - 1] : year === 2000 && month === 1 ? undefined : shift(-1);
  const next = available ? available[position + 1] : year === 2099 && month === 12 ? undefined : shift(1);
  const navigate = (selected: string) => {
    if (selected === value) return;
    confirmNavigation(() => start(() => {
      const [path, query] = href.split("?");
      const params = new URLSearchParams(query);
      params.set("mes", selected);
      router.push(`${path}?${params}`, { scroll: false });
    }));
  };
  const lastYear = Math.max(new Date().getUTCFullYear() + 1, year);

  return <div className="flex max-w-full flex-wrap items-center gap-2" aria-busy={pending}>
    <span id={id} className="sr-only">Mês do relatório</span>
    <Button variant="outline" size="icon" aria-label="Mês anterior" disabled={pending || !previous} onClick={() => previous && navigate(previous)}><ChevronLeft size={16} aria-hidden /></Button>
    {available ? <div className="w-52 max-w-full"><SelectMenu label="Mês do relatório" labelledBy={id} icon={CalendarDays} size="default" disabled={pending} value={value} options={[...available].reverse().map((m) => ({ value: m, label: monthLabel(m) }))} onChange={navigate} /></div> : <>
      <div className="w-36"><SelectMenu label="Mês do relatório" icon={CalendarDays} size="default" disabled={pending} value={String(month)} options={MONTHS.map((label, i) => ({ value: String(i + 1), label }))} onChange={(m) => navigate(`${year}-${m.padStart(2, "0")}`)} /></div>
      <div className="w-24"><SelectMenu label="Ano do relatório" size="default" disabled={pending} value={String(year)} options={Array.from({ length: lastYear - 2000 + 1 }, (_, i) => ({ value: String(lastYear - i), label: String(lastYear - i) }))} onChange={(y) => navigate(`${y}-${String(month).padStart(2, "0")}`)} /></div>
    </>}
    <Button variant="outline" size="icon" aria-label="Próximo mês" disabled={pending || !next} onClick={() => next && navigate(next)}><ChevronRight size={16} aria-hidden /></Button>
    <span role="status" className="sr-only">{pending ? "Carregando relatório" : monthLabel(value)}</span>
  </div>;
}
