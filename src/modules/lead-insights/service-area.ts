import { z } from "zod";
import { cleanCity, normalizeCity, sameCity } from "./city";

/**
 * Área de atendimento da clínica: a cidade-base e as outras cidades atendidas,
 * por nome. É a régua de "dentro ou fora do raio" — determinística: o sistema
 * compara a cidade que o contato disse com esta lista, sem pedir palpite ao LLM
 * sobre distância. Sem área configurada o resultado é "desconhecido", nunca um
 * "dentro" presumido. Puro (a leitura/gravação no banco fica em
 * `service-area-store.ts`).
 */

export type ServiceArea = {
  baseCity: string;
  /** Outras cidades atendidas, sem a base e sem repetição. */
  cities: string[];
};

export type CityVerdict = "in" | "out" | "unknown";

export const MAX_SERVICE_CITIES = 100;

/**
 * Lê a linha do banco (pode ser null, antiga ou editada à mão). Nunca lança;
 * sem cidade-base válida a área não está configurada.
 */
export function parseServiceArea(row: { baseCity?: unknown; cities?: unknown } | null | undefined): ServiceArea | null {
  const baseCity = cleanCity(row?.baseCity);
  if (!baseCity) return null;
  const cities = Array.isArray(row?.cities) ? row.cities.map(cleanCity).filter((c): c is string => Boolean(c)) : [];
  return { baseCity, cities: dedupeCities(baseCity, cities) };
}

/** Tira repetidas (por chave, então "Marília" e "marilia - SP" são uma) e a própria base. */
export function dedupeCities(baseCity: string, cities: string[]): string[] {
  const seen = new Set<string>();
  const baseKey = normalizeCity(baseCity);
  if (baseKey) seen.add(baseKey);
  const out: string[] = [];
  for (const city of cities) {
    const key = normalizeCity(city);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(city);
  }
  return out;
}

/** Dentro (base ou atendida), fora (qualquer outra) ou desconhecido (sem área ou sem cidade). */
export function classifyCity(area: ServiceArea | null, cityKey: string | null | undefined): CityVerdict {
  if (!area || !cityKey) return "unknown";
  const served = [area.baseCity, ...area.cities].map(normalizeCity);
  return served.some((key) => key && sameCity(key, cityKey)) ? "in" : "out";
}

/** Resumo de uma linha para o cartão fechado. */
export function describeServiceArea(area: ServiceArea | null): string {
  if (!area) return "Não configurada";
  return area.cities.length ? `${area.baseCity} e mais ${area.cities.length} ${area.cities.length === 1 ? "cidade" : "cidades"}` : area.baseCity;
}

/** Uma cidade por linha, ou separadas por vírgula/ponto e vírgula. */
export function splitCityList(text: string): string[] {
  return text.split(/[\n,;]+/).map((c) => c.trim()).filter(Boolean);
}

export const serviceAreaFormSchema = z.object({
  baseCity: z.string().trim().min(1, "Informe a cidade onde a clínica fica.").refine((v) => cleanCity(v) !== null, "Digite só o nome da cidade."),
  cities: z.string().default(""),
}).superRefine((form, ctx) => {
  const raw = splitCityList(form.cities);
  const invalid = raw.find((c) => cleanCity(c) === null);
  if (invalid) {
    ctx.addIssue({ code: "custom", path: ["cities"], message: `"${invalid.slice(0, 40)}" não parece o nome de uma cidade.` });
    return;
  }
  if (raw.length > MAX_SERVICE_CITIES) ctx.addIssue({ code: "custom", path: ["cities"], message: `No máximo ${MAX_SERVICE_CITIES} cidades.` });
}).transform((form) => {
  const baseCity = cleanCity(form.baseCity)!;
  return { baseCity, cities: dedupeCities(baseCity, splitCityList(form.cities).map((c) => cleanCity(c)!)) };
});
