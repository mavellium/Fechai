"use client";

import { useRouter } from "next/navigation";
import { CalendarCheck, Check, UserX, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-dialog";
import { useSaveFeedback } from "@/components/ui/toast/use-save-feedback";
import type { Attendance } from "@/modules/scheduling/dimensions";
import { cancelAppointmentAction, setAttendanceAction, setConfirmedAction } from "./actions";

/**
 * Ações de um compromisso de pé, uma por dimensão — nunca uma só que diga
 * tudo. O antigo "Concluir" fazia "realizado" valer como "compareceu".
 *
 * - **Antes do horário**: confirmar (o paciente disse que vem) e cancelar.
 * - **Depois do horário**: compareceu / faltou. Clicar de novo na marcação
 *   escolhida desfaz (volta a "não verificado").
 *
 * Quem pode o quê vem calculado do servidor (`canConfirm`/`canMarkAttendance`),
 * não do relógio do navegador; o servidor confere de novo na action.
 */
export function AppointmentActions({
  id,
  title,
  confirmed,
  attendance,
  canConfirm,
  canMarkAttendance,
}: {
  id: string;
  title: string;
  confirmed: boolean;
  attendance: Attendance;
  canConfirm: boolean;
  canMarkAttendance: boolean;
}) {
  const router = useRouter();
  const save = useSaveFeedback({ entity: "agendamento" });

  async function run(task: () => ReturnType<typeof setAttendanceAction>) {
    const res = await save.run(task);
    if (res.ok) router.refresh();
  }

  const mark = (value: Attendance) => () => run(() => setAttendanceAction(id, attendance === value ? "unknown" : value));

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canConfirm && (
        <Button
          variant={confirmed ? "ghost" : "outline"}
          size="sm"
          loading={save.saving}
          aria-pressed={confirmed}
          onClick={() => run(() => setConfirmedAction(id, !confirmed))}
        >
          <CalendarCheck size={14} aria-hidden />
          {confirmed ? "Desfazer confirmação" : "Confirmar"}
        </Button>
      )}

      {canMarkAttendance && (
        <>
          <Button
            variant={attendance === "attended" ? "default" : "outline"}
            size="sm"
            disabled={save.saving}
            aria-pressed={attendance === "attended"}
            onClick={mark("attended")}
          >
            <Check size={14} aria-hidden />
            Compareceu
          </Button>
          <Button
            variant={attendance === "no_show" ? "default" : "outline"}
            size="sm"
            disabled={save.saving}
            aria-pressed={attendance === "no_show"}
            onClick={mark("no_show")}
          >
            <UserX size={14} aria-hidden />
            Faltou
          </Button>
        </>
      )}

      {/* Consulta que já teve comparecimento marcado não se cancela: o que
          aconteceu não deixa de ter acontecido. Desfaça a marcação antes. */}
      {attendance === "unknown" && (
        <ConfirmButton
          size="sm"
          aria-label={`Cancelar ${title}`}
          confirm={{
            title: `Cancelar ${title}?`,
            description:
              "O horário volta a ficar livre. Se a conta estiver conectada ao Google Agenda, o evento também é removido de lá. O contato não é avisado automaticamente.",
            confirmLabel: "Cancelar compromisso",
            tone: "danger",
          }}
          onConfirm={() => run(() => cancelAppointmentAction(id))}
        >
          <X size={14} aria-hidden />
          Cancelar
        </ConfirmButton>
      )}
    </div>
  );
}
