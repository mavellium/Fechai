"use client";

export const STATUS: Record<string, string> = {
  draft: "Rascunho",
  queued: "Na fila",
  paused: "Pausado",
  completed: "Concluído",
  cancelled: "Cancelado",
  pending: "Pendente",
  sending: "Enviando",
  sent: "Aceito pela Meta",
  failed: "Falhou",
  unknown: "Conferir envio",
  skipped: "Ignorado",
};

export function RecipientTable({
  rows,
}: {
  rows: {
    id: string;
    row: number;
    phone: string;
    name: string | null;
    content: string;
    status: string;
    error: string | null;
    isTest?: boolean;
    deliveryStatus?: string | null;
    deliveryError?: string | null;
  }[];
}) {
  return (
    <div className="max-h-96 overflow-auto rounded-control border border-white/10">
      <table className="w-full text-left text-sm">
        <thead className="bg-ink text-xs text-white/60">
          <tr>
            <th className="p-3">Linha</th>
            <th className="p-3">Contato</th>
            <th className="p-3">Mensagem</th>
            <th className="p-3">Resultado</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/10">
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="p-3 align-top text-white/50">
                {row.isTest ? "Teste" : row.row}
              </td>
              <td className="p-3 align-top text-white/85">
                <p className="whitespace-nowrap">+{row.phone}</p>
                {row.name && (
                  <p className="mt-1 text-xs text-white/60">{row.name}</p>
                )}
              </td>
              <td className="min-w-56 max-w-lg whitespace-pre-wrap break-words p-3 align-top text-white/70">
                {row.content}
              </td>
              <td className="min-w-36 p-3 align-top text-white/70">
                {STATUS[row.status] ?? row.status}
                {row.deliveryStatus && (
                  <p className="mt-1 text-xs">
                    {{
                      sent: "Enviado",
                      delivered: "Entregue",
                      read: "Lido",
                      failed: "Falha na entrega",
                    }[row.deliveryStatus] ?? row.deliveryStatus}
                  </p>
                )}
                {row.deliveryError && (
                  <p className="mt-1 text-xs text-warn">{row.deliveryError}</p>
                )}
                {row.error && (
                  <p className="mt-1 text-xs text-warn">{row.error}</p>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
