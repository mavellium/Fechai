import { Phone, User } from "lucide-react";
import type { ClinicorpAgendaItem } from "@/modules/scheduling/clinicorp";
import { timeInZone } from "@/modules/scheduling/time";

/**
 * Consulta marcada direto no Clinicorp, na lista do dia.
 *
 * Só leitura, sem Lembretes/Concluir/Cancelar: ela não é um `Appointment` do
 * fechai (ver `listClinicorpAgenda`), então essas ações não teriam onde agir. A
 * origem vai escrita, não só na cor da faixa, para ninguém procurar o botão.
 */
export function ClinicorpAppointmentItem({
  item,
  timezone,
}: {
  item: ClinicorpAgendaItem;
  timezone: string;
}) {
  return (
    <li className="relative flex flex-col gap-3 rounded-surface border border-white/10 bg-white/[0.03] p-3.5">
      <span aria-hidden className="absolute left-0 top-3 bottom-3 w-1 rounded-full bg-white/30" />

      <div className="flex min-w-0 flex-1 items-start gap-3 pl-1.5">
        <span
          aria-hidden
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 font-display text-xs font-semibold uppercase text-white/80"
        >
          {item.patientName.slice(0, 1).toUpperCase()}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center rounded-control border border-iris/30 bg-iris/15 px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-iris">
              {timeInZone(item.startsAt, timezone)}
              {item.endsAt && `–${timeInZone(item.endsAt, timezone)}`}
            </span>
            <span className="truncate text-sm font-semibold text-white">{item.patientName}</span>
            <span className="ml-1 font-mono text-micro font-medium uppercase tracking-wider text-white/55">
              • no Clinicorp
            </span>
          </div>

          {(item.professional || item.phone) && (
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-micro uppercase tracking-wider text-white/70">
              {item.professional && (
                <span className="flex items-center gap-1">
                  <User size={12} aria-hidden className="text-white/40" />
                  {item.professional}
                </span>
              )}
              {item.phone && (
                <span className="flex items-center gap-1">
                  <Phone size={12} aria-hidden className="text-white/40" />
                  {item.phone}
                </span>
              )}
            </div>
          )}

          {item.notes && (
            <p className="mt-1.5 line-clamp-3 rounded-control border border-white/5 bg-black/20 px-2.5 py-1 text-xs leading-relaxed text-white/70">
              {item.notes}
            </p>
          )}

          <p className="mt-1.5 text-xs text-white/45">
            Marcada direto no Clinicorp. Para alterar ou cancelar, use o Clinicorp.
          </p>
        </div>
      </div>
    </li>
  );
}
