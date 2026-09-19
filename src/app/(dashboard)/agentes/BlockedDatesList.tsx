"use client";

import { useMemo, useState } from "react";
import { CalendarOff, Plus, Trash2 } from "lucide-react";
import { MAX_BLOCKED_DATES, isCalendarDate, type BlockedDate } from "@/modules/scheduling/config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Datas em que o negócio não atende: feriado, recesso, congresso, reforma.
 *
 * Existe porque a grade semanal só conhece DIA DA SEMANA — para ela, 25/12
 * numa quarta é só mais uma quarta, e sem esta lista o agente marcaria consulta
 * no Natal. A lista é manual de propósito: feriado nacional não é feriado para
 * toda clínica (muitas atendem), feriado municipal não caberia numa tabela
 * nossa, e recesso não é feriado nenhum.
 *
 * O estado é do pai (`value`/`onChange`), como em `ReminderList`: a lista é
 * enviada junto dos outros campos, num formulário que já tem o próprio botão.
 */
export function BlockedDatesList({
  value,
  onChange,
  disabled = false,
}: {
  value: BlockedDate[];
  onChange: (next: BlockedDate[]) => void;
  disabled?: boolean;
}) {
  const [date, setDate] = useState("");
  const [label, setLabel] = useState("");

  /** Hoje no formato do input — datas passadas não bloqueiam nada. */
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // Já na lista não entra de novo: bloquearia o mesmo dia duas vezes e
  // apareceria duplicado na tela.
  const duplicate = value.some((b) => b.date === date);
  const full = value.length >= MAX_BLOCKED_DATES;
  const canAdd = !disabled && !full && !duplicate && isCalendarDate(date);

  function add() {
    if (!canAdd) return;
    onChange(
      [...value, { date, label: label.trim().slice(0, 60) }].sort((a, b) =>
        a.date.localeCompare(b.date),
      ),
    );
    setDate("");
    setLabel("");
  }

  function remove(target: string) {
    onChange(value.filter((b) => b.date !== target));
  }

  // Passadas ficam separadas: continuam valendo (não apagamos histórico), mas
  // não são o que a pessoa confere ao abrir a tela.
  const upcoming = value.filter((b) => b.date >= today);
  const past = value.filter((b) => b.date < today);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[10rem] flex-1">
          <label htmlFor="blocked-date" className="text-xs font-medium text-white/70">
            Data
          </label>
          <Input
            id="blocked-date"
            type="date"
            value={date}
            min={today}
            disabled={disabled || full}
            onChange={(e) => setDate(e.currentTarget.value)}
            // Enter dentro de um formulário maior enviaria tudo; aqui ele só
            // acrescenta a linha, que é o que a pessoa espera ao digitar.
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            className="mt-1"
          />
        </div>

        <div className="min-w-[10rem] flex-[2]">
          <label htmlFor="blocked-label" className="text-xs font-medium text-white/70">
            Motivo <span className="font-normal text-white/45">(opcional)</span>
          </label>
          <Input
            id="blocked-label"
            value={label}
            maxLength={60}
            disabled={disabled || full}
            placeholder="Ex: Natal, recesso"
            onChange={(e) => setLabel(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            className="mt-1"
          />
        </div>

        <Button type="button" size="sm" variant="outline" disabled={!canAdd} onClick={add}>
          <Plus size={14} aria-hidden />
          Adicionar
        </Button>
      </div>

      {duplicate && (
        <p role="alert" className="text-xs text-warn">
          Essa data já está na lista.
        </p>
      )}
      {full && (
        <p role="alert" className="text-xs text-warn">
          Limite de {MAX_BLOCKED_DATES} datas atingido. Remova uma para incluir outra.
        </p>
      )}

      {value.length === 0 ? (
        <p className="flex items-center gap-2 rounded-control border border-white/10 bg-white/[0.035] px-3 py-2.5 text-sm text-white/55">
          <CalendarOff size={15} className="shrink-0 text-white/40" aria-hidden />
          Nenhuma data bloqueada — o agente atende em todos os dias liberados na grade.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {[...upcoming, ...past].map((b) => {
            const isPast = b.date < today;
            return (
              <li
                key={b.date}
                className={`flex items-center gap-2 rounded-control border border-white/10 bg-white/[0.035] px-3 py-2 text-sm ${
                  isPast ? "opacity-55" : ""
                }`}
              >
                <CalendarOff size={14} className="shrink-0 text-warn" aria-hidden />
                <span className="font-mono text-xs text-white/85">{formatDate(b.date)}</span>
                {b.label && <span className="truncate text-white/60">{b.label}</span>}
                {isPast && <span className="text-xs text-white/40">· já passou</span>}
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => remove(b.date)}
                  aria-label={`Remover ${formatDate(b.date)}${b.label ? ` (${b.label})` : ""}`}
                  className="ml-auto shrink-0 rounded p-1 text-white/45 outline-none transition-colors hover:text-danger focus-visible:ring-2 focus-visible:ring-danger disabled:opacity-50"
                >
                  <Trash2 size={14} aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <input type="hidden" name="blockedDates" value={JSON.stringify(value)} />
    </div>
  );
}

/** `2026-12-25` → `25/12/2026`. Sem `Date`: a string já é o dia local. */
function formatDate(iso: string) {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}
