/**
 * Reduz dois estados aos campos que realmente mudaram.
 *
 * A alternativa — gravar o objeto inteiro nos dois lados — faz a tela mentir:
 * salvar a persona tocando um campo apareceria como "18 campos alterados", e
 * quem lê o log teria que comparar os dois JSON a olho para achar o que mudou.
 * Pior, `recordChange` não conseguiria decidir se houve mudança alguma, e todo
 * clique em "Salvar" viraria uma linha, mesmo sem alteração nenhuma.
 */

export type FieldDiff = {
  /** Só os campos alterados, valor anterior. */
  before: Record<string, unknown>;
  /** Os mesmos campos, valor novo. */
  after: Record<string, unknown>;
  /** Nomes dos campos alterados, na ordem em que aparecem no objeto novo. */
  fields: string[];
};

/**
 * Compara dois objetos planos (o que sai de um `select` do Prisma).
 *
 * Só considera as chaves presentes em `after`: a action diz o que ela tocou, e
 * um `before` com mais campos (porque veio de um `findUnique` completo) não
 * deve inventar alterações em colunas que ninguém escreveu.
 */
export function diffFields(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): FieldDiff {
  const diff: FieldDiff = { before: {}, after: {}, fields: [] };
  if (!after) return diff;

  for (const [key, next] of Object.entries(after)) {
    const prev = before ? before[key] : undefined;
    if (sameValue(prev, next)) continue;
    diff.before[key] = normalize(prev);
    diff.after[key] = normalize(next);
    diff.fields.push(key);
  }
  return diff;
}

export function hasChanges(diff: FieldDiff): boolean {
  return diff.fields.length > 0;
}

/**
 * Igualdade por VALOR, não por referência.
 *
 * Sem isto, dois `Date` iguais e dois objetos JSON iguais contariam como
 * mudança em todo salvamento — `new Date(x) !== new Date(x)` em JS —, e o log
 * encheria de linhas em que nada mudou.
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;

  // null e undefined são a mesma ausência para efeito de auditoria: o Prisma
  // devolve null, o formulário manda undefined, e trocar um pelo outro não é
  // uma alteração que interesse a quem lê o log.
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;

  if (a instanceof Date || b instanceof Date) {
    const ta = a instanceof Date ? a.getTime() : new Date(a as string).getTime();
    const tb = b instanceof Date ? b.getTime() : new Date(b as string).getTime();
    return Number.isNaN(ta) && Number.isNaN(tb) ? String(a) === String(b) : ta === tb;
  }

  if (typeof a === "object" && typeof b === "object") {
    try {
      return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
    } catch {
      return false;
    }
  }

  return false;
}

/** Datas viram ISO para o JSON do banco; o resto passa direto. */
function normalize(value: unknown): unknown {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

/**
 * Ordena as chaves antes de comparar JSON: `{a,b}` e `{b,a}` são o mesmo
 * estado, e a ordem de um `select` do Prisma não é garantia de nada.
 */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
}
