import { normalizeLabel } from "./monthly-config";

/**
 * Decisor do relatório mensal × contato operacional.
 *
 * O decisor é quem decide a mensalidade: um dono ou sócio da clínica, que
 * recebe o relatório e a reunião de 30 min. Quem usa o painel no dia a dia
 * (recepção) é o contato operacional e recebe cópia. Os dois se confundiam num
 * campo livre, e o relatório acabava endereçado a quem não decide.
 *
 * "Dono ou sócio" não é `User.role = OWNER`: esse é o login da conta, que em
 * clínica costuma ser justamente o da recepção. A lista mora em
 * `Tenant.ownerNames`, mantida pela Mavellium na revisão.
 */
export const ACCOUNT_OWNERS_MAX = 8;
export const PERSON_NAME_MAX = 100;

/** Nunca lança: a coluna pode vir ausente (mock, conta antiga) ou editada à mão. */
export function parseAccountOwners(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>(), owners: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const name = item.trim().replace(/\s+/g, " ").slice(0, PERSON_NAME_MAX), key = normalizeLabel(name);
    if (!key || seen.has(key)) continue;
    seen.add(key); owners.push(name);
    if (owners.length === ACCOUNT_OWNERS_MAX) break;
  }
  return owners;
}

/** Um nome por linha, como a Mavellium digita na revisão. */
export function ownersFromText(text: string) {
  return parseAccountOwners(text.split("\n"));
}

export const samePerson = (a: string, b: string) => Boolean(normalizeLabel(a)) && normalizeLabel(a) === normalizeLabel(b);

/**
 * Por que este decisor não serve — ou `null` quando serve. Mesma regra na
 * tela, no salvar, no fechar e no registro do envio.
 */
export function decisionMakerProblem(report: { decisionMaker: string; operationalContact?: string }, owners: string[]): string | null {
  const name = report.decisionMaker.trim();
  if (!name) return "Escolha o decisor: o dono ou sócio que decide a mensalidade.";
  if (samePerson(name, report.operationalContact ?? "")) return "O decisor não pode ser o contato operacional. Escolha o dono ou sócio; a recepção recebe cópia.";
  if (!owners.some((owner) => samePerson(owner, name))) return `"${name}" não está entre os donos e sócios da conta. O decisor é quem decide a mensalidade, não quem opera o painel.`;
  return null;
}
