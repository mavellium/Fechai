import Link from "next/link";
import { cn } from "@/lib/utils";

const WEEKDAY_HEADERS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/**
 * Grade do mês.
 *
 * Server Component com links de verdade (`?ano=&mes=&dia=`) em vez de estado no
 * cliente: trocar de mês ou de dia vira URL compartilhável, funciona com o
 * botão voltar do navegador e não manda um calendário inteiro de JavaScript
 * para o navegador.
 *
 * A matemática de calendário usa `Date.UTC` de propósito — aqui são números de
 * calendário (dia 1, 31, quinta-feira), não instantes: usar horário local faria
 * o mês "virar" dependendo do fuso do servidor.
 */
export function CalendarMonth({
  year,
  month,
  selectedDay,
  today,
  countByDay,
  hrefFor,
}: {
  year: number;
  month: number;
  /** Dia selecionado (1..31) ou null. */
  selectedDay: number | null;
  /** Hoje no fuso do negócio — para destacar o dia corrente. */
  today: { year: number; month: number; day: number };
  /** Quantos compromissos em cada dia, indexado por "AAAA-MM-DD". */
  countByDay: Map<string, number>;
  hrefFor: (params: { year?: number; month?: number; day?: number | null }) => string;
}) {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const prev = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };

  const monthLabel = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );

  const navClass =
    "rounded-control px-3 py-1.5 font-mono text-micro uppercase tracking-[0.15em] text-white/60 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris";

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2">
        <Link href={hrefFor({ ...prev, day: null })} className={navClass} rel="prev">
          ← anterior
        </Link>
        <h2 className="font-display text-lg font-semibold capitalize text-white">{monthLabel}</h2>
        <Link href={hrefFor({ ...next, day: null })} className={navClass} rel="next">
          próximo →
        </Link>
      </div>

      <div className="grid grid-cols-7 gap-1" role="grid" aria-label={`Calendário de ${monthLabel}`}>
        {WEEKDAY_HEADERS.map((label) => (
          <div
            key={label}
            className="pb-1 text-center font-mono text-micro uppercase tracking-wide text-white/40"
          >
            {label}
          </div>
        ))}

        {/* Casas vazias antes do dia 1 — `aria-hidden` porque não são dias. */}
        {Array.from({ length: firstWeekday }).map((_, i) => (
          <div key={`empty-${i}`} aria-hidden />
        ))}

        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
          const key = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const count = countByDay.get(key) ?? 0;
          const isToday = today.year === year && today.month === month && today.day === day;
          const isSelected = selectedDay === day;

          return (
            <Link
              key={day}
              href={hrefFor({ year, month, day })}
              aria-current={isSelected ? "date" : undefined}
              aria-label={`${day} de ${monthLabel}${count > 0 ? `, ${count} compromisso(s)` : ", sem compromissos"}`}
              className={cn(
                "flex aspect-square flex-col items-center justify-center gap-1 rounded-control border text-sm transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris focus-visible:ring-offset-2 focus-visible:ring-offset-ink",
                isSelected
                  ? "border-iris bg-iris/20 text-white"
                  : "border-transparent text-white/70 hover:bg-white/5 hover:text-white",
                isToday && !isSelected && "border-white/25",
              )}
            >
              <span className={cn("tabular-nums", isToday && "font-semibold text-white")}>
                {day}
              </span>
              {/* Contagem em número, não só bolinha: a cor sozinha não diz
                  quantos compromissos existem naquele dia. */}
              {count > 0 && (
                <span className="rounded-full bg-signal/25 px-1.5 font-mono text-[10px] leading-4 text-white">
                  {count}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
