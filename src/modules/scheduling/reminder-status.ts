export type ReminderStatus = { state: string; reason: string | null; provider: string | null; deliveryStatus: string | null; at: string | null };
export function reminderStatusText(status?: ReminderStatus | null) {
  if (!status) return "Aguardando o horário da confirmação";
  if (status.deliveryStatus === "read") return "Confirmação lida";
  if (status.deliveryStatus === "delivered") return "Confirmação entregue";
  if (status.deliveryStatus === "failed") return "Falha de entrega. Confira o WhatsApp";
  if (status.state === "sent") return "Envio aceito pelo WhatsApp; entrega ainda não confirmada";
  if (status.state === "manual") return "Confirmação tratada pela equipe";
  if (status.state === "sending") return "Envio em andamento";
  if (status.state === "unknown") return "Envio sem confirmação. Confira o WhatsApp";
  return status.reason || "Aguardando envio";
}
