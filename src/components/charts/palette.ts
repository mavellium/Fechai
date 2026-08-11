/**
 * Paleta categórica dos gráficos de /relatorios, validada com o script
 * `validate_palette.js` do skill dataviz (seis checks: banda de luminosidade,
 * piso de croma, separação CVD, piso de visão normal, contraste vs. superfície).
 *
 * A ordem antiga do donut (`iris, success, warn, signal, cinza`) reprovava:
 * `#ff6b4a` (signal) e `#f59e0b` (warn) ficavam adjacentes com ΔE 12,7 em visão
 * normal (piso é 15) e 7,2 em deuteranopia — duas fatias vizinhas que boa parte
 * dos leitores não distingue. O cinza `#94a3b8` também reprovava o piso de
 * croma (lê como cinza morto, sem identidade própria).
 *
 * Esta ordem — iris → warn → success → signal → violeta — separa o par
 * reprovado e passa ALL CHECKS PASS nos dois modos (claro `--mode light`,
 * escuro `--mode dark`, hex exatos abaixo). Os valores reais são variáveis CSS
 * (`globals.css`, `--chart-1..5`), escopadas por `[data-surface="dark"]` — o
 * mesmo mecanismo que todo o resto do painel já usa para claro/escuro (nunca
 * `prefers-color-scheme`: o produto decide a superfície por rota). SVG não
 * aceita classe Tailwind para `stroke`/`fill` dinâmico, só `var(...)`.
 *
 * // claro (surface #fcfcfb) — ALL CHECKS PASS
 * ["#4b3cf0", "#f59e0b", "#1fc8a3", "#ff6b4a", "#a855f7"]
 * // escuro (surface #1a1a19) — ALL CHECKS PASS, passos próprios
 * ["#8b7cf8", "#d97706", "#0d9e80", "#e2543a", "#a855f7"]
 */
export const CHART_VARS = ["--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5"] as const;

/**
 * Variável CSS por posição na paleta. Uso: `chartColor(i)` para a i-ésima
 * entidade de uma lista já ordenada (ex.: agentes por nome) — claro/escuro
 * resolvem sozinhos porque é `var(--chart-N)`, não um hex fixo.
 *
 * Regra que não pode quebrar: cor segue a ENTIDADE, nunca o rank de contagem.
 * Se a lista for reordenada por valor (do maior pro menor, como hoje o donut
 * faz), filtrar ou remover uma entidade repinta as sobreviventes — o leitor
 * que aprendeu "Ana é roxa" é enganado. Ordene por uma chave estável (nome,
 * id de criação) antes de mapear para cor, não por contagem.
 *
 * Nunca gerar uma 9ª cor: acima de 8 entidades, agrupe o excedente em
 * "Outros" (como o donut já faz) em vez de ciclar a paleta.
 */
export function chartColor(index: number): string {
  return `var(${CHART_VARS[index % CHART_VARS.length]})`;
}

/** Cinza de contexto para o padrão "emphasis" (uma série em destaque, resto cinza). */
export const CHART_MUTED = "var(--chart-muted)";
