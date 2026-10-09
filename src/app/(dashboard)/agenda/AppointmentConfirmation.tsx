"use client";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useActionToast } from "@/components/ui/toast/use-save-feedback";
import { formatInZone } from "@/modules/scheduling/time";
import { reminderStatusText, type ReminderStatus } from "@/modules/scheduling/reminder-status";
import { appointmentConfirmationAction } from "./confirmation-actions";

export function AppointmentConfirmation({ id, source, startsAt, timezone, status, disabled = false }: {
  id: string; source: "clinicorp" | "appointment"; startsAt: string; timezone: string; status?: ReminderStatus | null; disabled?: boolean;
}) {
  const router = useRouter();
  const [result, action, pending] = useActionState(appointmentConfirmationAction, null);
  useActionToast(result, pending, { entity: "confirmação", gender: "f" });
  useEffect(() => { if (result) router.refresh(); }, [result, router]);
  return <div className="mt-2 space-y-2">
    <p className="text-xs text-white/65" role="status">{reminderStatusText(status)}{status?.provider ? ` · ${status.provider === "meta" ? "Meta" : "QR"}` : ""}{status?.at ? ` · ${formatInZone(new Date(status.at), timezone)}` : ""}</p>
    {!disabled && <form action={action} className="flex flex-wrap gap-2">
      <input type="hidden" name="id" value={id} /><input type="hidden" name="source" value={source} />
      <input type="hidden" name="startsAt" value={startsAt} />
      <Button size="sm" variant="outline" name="operation" value="send" loading={pending}>Enviar confirmação agora</Button>
      <Button size="sm" variant="ghost" name="operation" value="manual" disabled={pending}>Já enviei pelo WhatsApp</Button>
    </form>}
  </div>;
}
