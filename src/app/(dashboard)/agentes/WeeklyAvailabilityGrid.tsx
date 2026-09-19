"use client";

import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { CalendarDays, Check, MousePointer2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SelectMenu } from "@/components/ui/select-menu";
import { weekdayLabel } from "@/modules/scheduling/config";
import { describeRanges, emptyWeek, minuteLabel, paintAvailability, rangeCoverage, type WeeklyAvailability } from "@/modules/scheduling/weekly-availability";

type Gesture = { base: WeeklyAvailability; day: number; slot: number; available: boolean; pointer: number; last: string };
const DAYS = [0, 1, 2, 3, 4, 5, 6];
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

export function WeeklyAvailabilityGrid({ value, onChange, disabled = false }: {
  value: WeeklyAvailability;
  onChange: (next: WeeklyAvailability) => void;
  disabled?: boolean;
}) {
  const [step, setStep] = useState(60);
  const [undo, setUndo] = useState<WeeklyAvailability | null>(null);
  const [focused, setFocused] = useState({ day: 1, slot: 9 });
  const [message, setMessage] = useState("");
  const tableRef = useRef<HTMLTableElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const hintId = useId();
  const columns = 1440 / step;
  const countDays = value.filter((ranges) => ranges.length).length;
  const minutes = value.flat().reduce((total, range) => total + range.end - range.start, 0);

  function change(next: WeeklyAvailability, announcement: string) {
    if (disabled) return;
    setUndo(value);
    onChange(next);
    setMessage(announcement);
  }

  function paint(day: number, slot: number) {
    const g = gesture.current;
    if (!g || disabled || g.last === `${day}:${slot}`) return;
    g.last = `${day}:${slot}`;
    onChange(paintAvailability(g.base, g.day, day, Math.min(g.slot, slot) * step, (Math.max(g.slot, slot) + 1) * step, g.available));
  }

  function start(event: PointerEvent<HTMLButtonElement>, day: number, slot: number) {
    if (disabled || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    setFocused({ day, slot });
    const available = rangeCoverage(value[day], slot * step, (slot + 1) * step) < step;
    gesture.current = { base: value, day, slot, available, pointer: event.pointerId, last: "" };
    setUndo(value);
    tableRef.current?.setPointerCapture(event.pointerId);
    paint(day, slot);
  }

  function move(event: PointerEvent<HTMLTableElement>) {
    if (!gesture.current || event.pointerId !== gesture.current.pointer) return;
    const cell = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-week-cell]");
    if (cell && tableRef.current?.contains(cell)) paint(Number(cell.dataset.day), Number(cell.dataset.slot));
  }

  function finish(cancel = false) {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    if (cancel) { onChange(g.base); setMessage("Seleção cancelada."); }
    else setMessage(g.available ? "Período selecionado. Salve as configurações para aplicar." : "Período removido. Salve as configurações para aplicar.");
    if (tableRef.current?.hasPointerCapture(g.pointer)) tableRef.current.releasePointerCapture(g.pointer);
  }

  function keyboard(event: KeyboardEvent<HTMLButtonElement>, day: number, slot: number) {
    if (event.key === "Escape") { finish(true); return; }
    let nextDay = day, nextSlot = slot;
    if (event.key === "ArrowRight") nextSlot = Math.min(columns - 1, slot + 1);
    else if (event.key === "ArrowLeft") nextSlot = Math.max(0, slot - 1);
    else if (event.key === "ArrowDown") nextDay = Math.min(6, day + 1);
    else if (event.key === "ArrowUp") nextDay = Math.max(0, day - 1);
    else if (event.key === "Home") nextSlot = 0;
    else if (event.key === "End") nextSlot = columns - 1;
    else return;
    event.preventDefault();
    setFocused({ day: nextDay, slot: nextSlot });
    tableRef.current?.querySelector<HTMLButtonElement>(`button[data-day="${nextDay}"][data-slot="${nextSlot}"]`)?.focus();
  }

  return <section className="overflow-hidden rounded-surface border border-success/25 bg-ink/65 shadow-[0_0_36px_-18px_color-mix(in_srgb,var(--color-success)_30%,transparent)]" aria-label="Disponibilidade semanal">
    <input type="hidden" name="weeklyAvailability" value={JSON.stringify(value)} />
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 bg-gradient-to-r from-success/10 to-transparent p-5">
      <div className="flex gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-success/15 text-success"><CalendarDays size={21} aria-hidden /></span>
        <div><h3 className="font-display text-lg font-semibold text-white">Sua semana de atendimento</h3>
          <p className="mt-1 text-sm text-white/60">Escolha de uma vez os dias e horários em que o agente pode agendar.</p></div>
      </div>
      <span className="rounded-full border border-success/20 bg-success/10 px-3 py-1.5 text-xs font-medium text-success">{countDays} dias · {(minutes / 60).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}h por semana</span>
    </div>

    <div className="space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p id={hintId} className="flex max-w-lg items-start gap-2 text-sm text-white/70"><MousePointer2 size={16} className="mt-0.5 shrink-0 text-success" aria-hidden />Clique e arraste para liberar horários. Comece em um bloco marcado para remover. Deixe o almoço e as pausas desmarcados.</p>
        <div className="w-40"><SelectMenu label="Tamanho dos blocos da grade" value={String(step)} disabled={disabled} options={[{ value: "60", label: "Blocos de 1 hora" }, { value: "30", label: "Blocos de 30 min" }, { value: "15", label: "Blocos de 15 min" }]} onChange={(next) => {
          const newStep = Number(next);
          setFocused((current) => ({ ...current, slot: Math.floor(current.slot * step / newStep) }));
          setStep(newStep);
        }} /></div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" type="button" variant="outline" disabled={disabled} onClick={() => change(DAYS.map((day) => day > 0 && day < 6 ? [{ start: 540, end: 1080 }] : []), "Segunda a sexta, das 9 às 18 horas. Ajuste as pausas na grade.")}>Seg–Sex, 9h–18h</Button>
        <Button size="sm" type="button" variant="ghost" disabled={disabled || !minutes} onClick={() => change(emptyWeek(), "Todos os horários foram removidos.")}>Limpar semana</Button>
        <Button size="sm" type="button" variant="ghost" disabled={disabled || !undo} onClick={() => { if (undo) { onChange(undo); setUndo(null); setMessage("Última alteração desfeita."); } }}><Undo2 size={14} aria-hidden />Desfazer</Button>
        <span className="ml-auto flex items-center gap-2 text-xs text-white/55"><span className="h-2.5 w-2.5 rounded-sm bg-success" />Disponível<span className="ml-2 h-2.5 w-2.5 rounded-sm border border-white/20 bg-white/5" />Indisponível</span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-white/15" aria-label="Grade de dias e horários">
        <table ref={tableRef} className="w-full table-fixed select-none border-collapse text-sm" style={{ minWidth: step === 60 ? 840 : step === 30 ? 1260 : 2100 }}
          onPointerMove={move} onPointerUp={() => finish()} onPointerCancel={() => finish(true)} onLostPointerCapture={() => finish()} aria-describedby={hintId}>
          <caption className="sr-only">Disponibilidade de domingo a sábado. Use as setas para navegar e Espaço ou Enter para marcar. O botão de cada dia seleciona ou remove as 24 horas.</caption>
          <colgroup><col style={{ width: 124 }} />{Array.from({ length: columns }, (_, slot) => <col key={slot} />)}</colgroup>
          <thead className="bg-white/[0.04] text-white/65">
            <tr><th scope="col" rowSpan={step === 60 ? 1 : 2} className="sticky left-0 z-10 bg-ink px-3 py-3 text-left text-xs font-medium">Dia / horário</th>{HOURS.map((hour) => <th key={hour} scope="colgroup" colSpan={60 / step} className="py-3 text-center font-mono text-xs font-normal">{String(hour).padStart(2, "0")}</th>)}</tr>
            {step !== 60 && <tr>{Array.from({ length: columns }, (_, slot) => <th key={slot} scope="col" className="pb-2 text-center font-mono text-[10px] font-normal text-white/40">:{String(slot * step % 60).padStart(2, "0")}</th>)}</tr>}
          </thead>
          <tbody>{DAYS.map((day) => <tr key={day} className="border-t border-white/10">
            <th scope="row" className="sticky left-0 z-10 bg-ink px-2 py-2 text-left">
              <button type="button" disabled={disabled} className="flex w-full items-center gap-2 rounded px-1 py-2 text-xs font-medium text-white/80 outline-none hover:text-white focus-visible:ring-2 focus-visible:ring-success disabled:opacity-50"
                aria-label={`${value[day].length ? "Limpar horários de" : "Liberar 24 horas de"} ${weekdayLabel(day)}`} title={describeRanges(value[day])}
                onClick={() => change(value.map((ranges, index) => index === day ? ranges.length ? [] : [{ start: 0, end: 1440 }] : ranges), `${weekdayLabel(day)} atualizado.`)}>
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${value[day].length ? "border-success/60 bg-success/20 text-success" : "border-white/25"}`}>{value[day].length > 0 && <Check size={11} aria-hidden />}</span>{weekdayLabel(day)}
              </button>
            </th>
            {Array.from({ length: columns }, (_, slot) => {
              const startMinute = slot * step, endMinute = startMinute + step;
              const coverage = rangeCoverage(value[day], startMinute, endMinute);
              const full = coverage === step;
              const label = `${weekdayLabel(day)}, ${minuteLabel(startMinute)} às ${minuteLabel(endMinute)}`;
              return <td key={slot} className="px-0.5 py-2" data-week-cell data-day={day} data-slot={slot}>
                <button type="button" disabled={disabled} data-week-cell data-day={day} data-slot={slot}
                  aria-label={label} aria-pressed={full ? true : coverage ? "mixed" : false} title={`${label} · ${full ? "Disponível" : coverage ? "Parcialmente disponível: " + describeRanges(value[day].filter((r) => r.start < endMinute && r.end > startMinute)) : "Indisponível"}`}
                  tabIndex={focused.day === day && focused.slot === slot ? 0 : -1}
                  className="relative block h-8 w-full touch-none overflow-hidden rounded border border-white/[0.07] bg-white/[0.035] outline-none transition-[box-shadow,border-color] hover:border-success/60 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-white disabled:opacity-50"
                  onPointerDown={(event) => start(event, day, slot)} onKeyDown={(event) => keyboard(event, day, slot)}
                  onClick={(event) => { if (event.detail === 0) change(paintAvailability(value, day, day, startMinute, endMinute, !full), `${label}: ${full ? "indisponível" : "disponível"}.`); }}>
                  {value[day].map((r, index) => {
                    const from = Math.max(startMinute, r.start), to = Math.min(endMinute, r.end);
                    return to > from ? <span key={index} aria-hidden className="pointer-events-none absolute inset-y-0 bg-success/85" style={{ left: `${(from - startMinute) / step * 100}%`, width: `${(to - from) / step * 100}%` }} /> : null;
                  })}
                </button>
              </td>;
            })}
          </tr>)}</tbody>
        </table>
      </div>
      <div className="flex flex-wrap justify-between gap-2 text-xs text-white/50"><span>Horários no fuso escolhido abaixo. Cada bloco libera todo o intervalo indicado.</span><span>← Role para ver as 24 horas →</span></div>
      {!minutes && <p className="rounded-control border border-warn/25 bg-warn/10 p-3 text-sm text-warn">Nenhum horário disponível. Ao salvar assim, o agente não oferecerá novos agendamentos.</p>}
      <details className="text-sm text-white/65"><summary className="cursor-pointer rounded py-1 outline-none focus-visible:ring-2 focus-visible:ring-success">Conferir horários por dia</summary><dl className="mt-3 grid gap-2 sm:grid-cols-2">{DAYS.map((day) => <div key={day} className="rounded-lg bg-white/[0.035] px-3 py-2"><dt className="text-xs text-white/45">{weekdayLabel(day)}</dt><dd className="mt-1 text-xs leading-relaxed text-white/80">{describeRanges(value[day])}</dd></div>)}</dl></details>
      <p role="status" className="sr-only">{message}</p>
    </div>
  </section>;
}
