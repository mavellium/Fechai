"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-dialog";
import { Alert } from "@/components/ui/alert";
import { cancelAppointmentAction, completeAppointmentAction } from "./actions";

/**
 * Concluir / cancelar um compromisso. Só aparece nos que ainda estão de pé —
 * cancelar algo já cancelado não é uma ação, é ruído.
 */
export function AppointmentActions({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await completeAppointmentAction(id);
            if (!res.ok) setError(res.error ?? "Falha ao concluir.");
            else router.refresh();
          })
        }
      >
        <Check size={14} aria-hidden />
        Concluir
      </Button>

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
        onConfirm={async () => {
          const res = await cancelAppointmentAction(id);
          if (!res.ok) setError(res.error ?? "Falha ao cancelar.");
          else router.refresh();
        }}
      >
        <X size={14} aria-hidden />
        Cancelar
      </ConfirmButton>

      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  );
}
