export type LogFilterValues = {
  q: string;
  /**
   * Vários por campo, como na lista de contas: "o que o admin OU o sistema
   * fez" e "eventos de agente OU de conta" são perguntas reais de quem está
   * investigando um incidente.
   */
  grupo: string[];
  autor: string[];
  tipo: string[];
  /** Janela em dias (1 · 7 · 30 · 90 · 365). */
  dias: number;
  /** Só o que ainda pode ser desfeito. */
  pendentes: boolean;
  /** Preso a uma conta específica (veio de um link de /admin/contas). */
  conta: string;
};

export const FILTER_KEYS = ["grupo", "autor", "tipo"] as const;
export type FieldKey = (typeof FILTER_KEYS)[number];

/** Janelas oferecidas. Valor fora daqui cai no padrão — nunca vira SQL livre. */
export const DAY_OPTIONS = [1, 7, 30, 90, 365] as const;
export const DEFAULT_DAYS = 30;

/**
 * Janela confiável a partir do que veio na URL.
 *
 * Mesma razão do `normalizePageSize` das contas: o número vem do endereço, e
 * um valor livre deixaria qualquer visitante pedir `?dias=99999` — uma varredura
 * da tabela inteira por conta de um parâmetro digitado à mão.
 */
export function normalizeDays(raw: string | undefined): number {
  const n = Number(raw);
  return (DAY_OPTIONS as readonly number[]).includes(n) ? n : DEFAULT_DAYS;
}

/**
 * O endereço da trilha a partir dos filtros.
 *
 * Vive fora dos componentes pelo mesmo motivo do `filter-url` das contas: a
 * busca e o painel de filtros escrevem na MESMA URL, e com uma cópia em cada um
 * quem digitasse no campo de busca apagaria o filtro aplicado por esquecimento
 * de um parâmetro.
 *
 * Só o que está preenchido entra, e o que está no padrão fica de fora — a URL
 * limpa é a da tela como ela abre.
 */
export function filtersToHref(next: LogFilterValues): string {
  const qs = new URLSearchParams();
  if (next.q) qs.set("q", next.q);
  for (const key of FILTER_KEYS) {
    if (next[key].length > 0) qs.set(key, next[key].join(","));
  }
  if (next.dias !== DEFAULT_DAYS) qs.set("dias", String(next.dias));
  if (next.pendentes) qs.set("pendentes", "1");
  if (next.conta) qs.set("conta", next.conta);

  const s = qs.toString();
  return s ? `/admin/logs?${s}` : "/admin/logs";
}

/**
 * O mesmo endereço, mais o cursor da próxima página.
 *
 * Separado de `filtersToHref` de propósito: o cursor é posição, não filtro.
 * Se entrasse no construtor principal, qualquer mudança de filtro carregaria
 * junto o cursor da lista anterior — e a lista nova abriria no meio, pulando
 * as linhas de cima.
 */
export function filtersToHrefWithCursor(next: LogFilterValues, cursor: string): string {
  const base = filtersToHref(next);
  return base.includes("?") ? `${base}&cursor=${cursor}` : `${base}?cursor=${cursor}`;
}
