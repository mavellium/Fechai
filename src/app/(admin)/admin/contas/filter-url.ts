export type TenantFilterValues = {
  q: string;
  /** Vários por campo: "quem está no Free OU no Starter" é uma pergunta real. */
  status: string[];
  plan: string[];
  whatsapp: string[];
  trial: string[];
  sort: string;
  /** Quantas linhas trazer (20 · 50 · 100 · 200). */
  limite: number;
};

export const FILTER_KEYS = ["status", "plan", "whatsapp", "trial"] as const;
export type FieldKey = (typeof FILTER_KEYS)[number];

/**
 * O endereço da lista a partir dos filtros.
 *
 * Só o que está preenchido entra: um endereço cheio de `&plan=` vazio é
 * ilegível e não diz o que está filtrado. Valor igual ao padrão também fica de
 * fora — a URL limpa é a da tela como ela abre.
 *
 * Vive fora dos componentes porque a busca e o painel de filtros escrevem na
 * MESMA URL: com uma cópia em cada um, quem digitasse no campo de busca
 * apagaria o filtro aplicado (e vice-versa) por esquecimento de um parâmetro.
 */
export function filtersToHref(next: TenantFilterValues, defaultLimit: number): string {
  const qs = new URLSearchParams();
  if (next.q) qs.set("q", next.q);
  for (const key of FILTER_KEYS) {
    if (next[key].length > 0) qs.set(key, next[key].join(","));
  }
  if (next.sort && next.sort !== "recentes") qs.set("sort", next.sort);
  if (next.limite !== defaultLimit) qs.set("limite", String(next.limite));

  const s = qs.toString();
  return s ? `/admin/contas?${s}` : "/admin/contas";
}
