/**
 * Rótulos dos status de lead (`prisma/schema.prisma` → Lead.status).
 *
 * A tela mostrava o valor cru do banco ("warm", "needs_human") ao lado de
 * filtros já traduzidos ("Mornos") — o mesmo estado aparecia com dois nomes.
 */
export const LEAD_STATUS: Record<string, { label: string; tone: "neutral" | "warn" | "danger" | "success" | "iris" }> = {
  new: { label: "Novo", tone: "neutral" },
  warm: { label: "Morno", tone: "iris" },
  hot: { label: "Quente", tone: "warn" },
  scheduled: { label: "Agendado", tone: "success" },
  lost: { label: "Perdido", tone: "danger" },
};

export function leadStatusLabel(status: string) {
  return LEAD_STATUS[status] ?? { label: status, tone: "neutral" as const };
}

export const CONVERSA_FILTERS = [
  { key: "all", label: "Todos" },
  { key: "new", label: "Novos" },
  { key: "warm", label: "Mornos" },
  { key: "hot", label: "Quentes" },
  { key: "scheduled", label: "Agendados" },
  { key: "needs_human", label: "Precisa de você" },
  { key: "test", label: "Testes" },
];
