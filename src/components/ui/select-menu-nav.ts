/**
 * Navegação por teclado do `SelectMenu`, separada da renderização.
 *
 * Fica em módulo próprio porque é a parte que dá errado em silêncio: um menu
 * artesanal substitui um `<select>` nativo que já vinha com teclado pronto e
 * testado, então a lógica de andar entre as opções — dar a volta nas pontas,
 * pular as desabilitadas — precisa de teste. A suíte do projeto roda em Node,
 * sem DOM (ver `vitest.config.ts`), e uma função pura é testável ali.
 */

/**
 * Próximo índice a partir de `from` na direção `dir`, dando a volta nas pontas
 * e pulando opções desabilitadas.
 *
 * Devolve `from` quando não há nenhuma opção habilitada para onde ir — o cursor
 * fica onde está em vez de a tecla não fazer nada de forma inexplicada.
 */
export function stepIndex(
  from: number,
  dir: 1 | -1,
  options: { disabled?: boolean }[],
): number {
  const n = options.length;
  if (n === 0) return from;

  for (let i = 1; i <= n; i++) {
    // `+ n` antes do módulo: em JS, (-1 % 5) é -1, não 4.
    const next = (((from + dir * i) % n) + n) % n;
    if (!options[next]?.disabled) return next;
  }
  return from;
}

/** Primeira opção habilitada — destino do Home. */
export function firstEnabledIndex(options: { disabled?: boolean }[]): number {
  const i = options.findIndex((o) => !o.disabled);
  return i === -1 ? 0 : i;
}

/** Última opção habilitada — destino do End. */
export function lastEnabledIndex(options: { disabled?: boolean }[]): number {
  for (let i = options.length - 1; i >= 0; i--) {
    if (!options[i]?.disabled) return i;
  }
  return 0;
}
