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

/**
 * Opções do seletor de conversas: os estágios do lead e, separada por uma
 * linha, a origem "Testes".
 *
 * "Precisa de você" continua fora — é urgência, não recorte da lista, e mora
 * no destaque acima do seletor (com contagem, para ser visto sem abrir nada).
 * "Testes" está aqui porque também é um recorte, só que por origem do dado
 * (sandbox) e não por estágio: daí o `separatorBefore`, que o mantém à vista
 * sem fingir que é mais um estágio do funil.
 */
export const CONVERSA_STAGES: {
  key: string;
  label: string;
  dot?: string;
  separatorBefore?: boolean;
}[] = [
  { key: "all", label: "Todas as conversas" },
  // O ponto repete a cor do badge que a conversa exibe na lista — o mesmo
  // estágio com a mesma cor nos dois lugares, para o filtro e a linha
  // conversarem sem precisar de legenda.
  { key: "new", label: "Novos", dot: "bg-neutral" },
  { key: "warm", label: "Mornos", dot: "bg-iris" },
  { key: "hot", label: "Quentes", dot: "bg-warn" },
  { key: "scheduled", label: "Agendados", dot: "bg-success" },
  { key: "test", label: "Conversas de teste", separatorBefore: true },
];
