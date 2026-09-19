/**
 * Endereço brasileiro a partir de fontes públicas: CEP pelo ViaCEP e lista de
 * municípios por UF pelo IBGE.
 *
 * Este módulo roda no **cliente** (o formulário de cadastro chama direto): os
 * dois serviços são abertos, sem chave, e mandar a requisição pelo nosso
 * servidor só acrescentaria um salto e um ponto de falha nosso a um dado que é
 * público de qualquer jeito.
 *
 * **Nada aqui lança.** Preencher endereço sozinho é uma conveniência, nunca um
 * requisito: ViaCEP fora do ar, CEP que não existe ou rede lenta devolvem
 * `null` e a pessoa digita à mão — um cadastro não pode empacar porque um
 * terceiro caiu. Quem chama decide o que mostrar; a validação de verdade dos
 * campos continua no formulário e no servidor.
 */

import { onlyDigits } from "./br-lead";

/** Quanto esperamos por um serviço externo antes de liberar o preenchimento manual. */
const TIMEOUT_MS = 8000;

export type CepAddress = {
  cep: string;
  /** Logradouro ("Avenida Paulista"). Vem vazio em CEP de cidade inteira. */
  street: string;
  neighborhood: string;
  city: string;
  state: string;
};

export type Municipality = { value: string; label: string };

/** `fetch` com teto de tempo que devolve `null` em qualquer falha. */
async function getJson<T>(url: string): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    // Rede, CORS, abort, JSON quebrado: todos têm a mesma resposta para quem
    // chama — não deu, siga no manual.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

type ViaCepResponse = {
  cep?: string;
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  /** O ViaCEP responde 200 com `{ erro: true }` quando o CEP não existe. */
  erro?: boolean | string;
};

/**
 * Busca o endereço de um CEP. Devolve `null` quando o CEP não existe ou o
 * serviço não respondeu — os dois casos terminam do mesmo jeito para quem está
 * preenchendo: os campos ficam editáveis.
 */
export async function lookupCep(cep: string): Promise<CepAddress | null> {
  const digits = onlyDigits(cep);
  if (digits.length !== 8) return null;

  const data = await getJson<ViaCepResponse>(`https://viacep.com.br/ws/${digits}/json/`);
  // `erro` chega como boolean ou como a string "true" dependendo do CEP.
  if (!data || data.erro === true || data.erro === "true" || !data.uf) return null;

  return {
    cep: digits,
    street: data.logradouro?.trim() ?? "",
    neighborhood: data.bairro?.trim() ?? "",
    city: data.localidade?.trim() ?? "",
    state: data.uf.trim().toUpperCase(),
  };
}

/**
 * Municípios de uma UF, em ordem alfabética, direto do IBGE.
 *
 * A lista é o **valor e o rótulo ao mesmo tempo** (o nome do município), e não
 * o código do IBGE: é o nome que o resto do produto já guarda em `Tenant.city`
 * e o que o ViaCEP devolve — guardar código aqui exigiria traduzir nos dois
 * sentidos toda vez que alguém quisesse ler a cidade.
 *
 * Devolve `[]` em falha, e quem chama cai no campo de texto livre.
 */
export async function listMunicipalities(state: string): Promise<Municipality[]> {
  const uf = state.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(uf)) return [];

  const data = await getJson<{ nome?: string }[]>(
    `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`,
  );
  if (!Array.isArray(data)) return [];

  return data
    .map((m) => m.nome?.trim())
    .filter((nome): nome is string => Boolean(nome))
    .sort((a, b) => a.localeCompare(b, "pt-BR"))
    .map((nome) => ({ value: nome, label: nome }));
}
