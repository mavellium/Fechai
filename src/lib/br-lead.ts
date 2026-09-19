/**
 * Dados de qualificação do lead capturados no /cadastro: validação e máscara de
 * CNPJ, telefone e CEP, e as listas de opções dos selects (UF, segmento de
 * negócio, como conheceu o fechai). Um módulo só porque o formulário de
 * cadastro e a rota `/api/register` precisam da mesma regra — duas cópias
 * divergentes deixariam passar no cliente o que o servidor rejeita.
 *
 * **O fechai aceita apenas empresas.** O documento é CNPJ, ponto — não existe
 * mais o caminho de pessoa física. A validação de CPF foi removida junto com os
 * campos pessoais (nascimento, gênero): quem assina é um negócio.
 */

/** Mantém só dígitos — é como CNPJ, telefone e CEP são guardados no banco. */
export function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

/**
 * Dígitos verificadores do CNPJ (algoritmo do módulo 11 da Receita Federal).
 * Também rejeita sequências repetidas ("00000000000000"), que passariam no
 * cálculo mas nunca são CNPJs reais.
 */
export function isValidCNPJ(digits: string) {
  if (digits.length !== 14 || /^(\d)\1{13}$/.test(digits)) return false;
  const calc = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(digits[i]) * weights[i];
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return calc(12) === Number(digits[12]) && calc(13) === Number(digits[13]);
}

/** O único campo "documento" do cadastro — CNPJ, porque só empresas entram. */
export function isValidCnpj(value: string) {
  return isValidCNPJ(onlyDigits(value));
}

/** Máscara de CNPJ enquanto digita: 00.000.000/0000-00. */
export function maskCnpj(value: string) {
  return onlyDigits(value)
    .slice(0, 14)
    .replace(/(\d{2})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1/$2")
    .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
}

/** Máscara de telefone BR enquanto digita: (11) 98765-4321 ou (11) 3456-7890. */
export function maskPhone(value: string) {
  const d = onlyDigits(value).slice(0, 11);
  if (d.length <= 10) {
    return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d{1,4})$/, "$1-$2");
  }
  return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d{1,4})$/, "$1-$2");
}

/** Telefone plausível: DDD + 8 ou 9 dígitos (não valida se a linha existe). */
export function isValidPhone(value: string) {
  const d = onlyDigits(value);
  return d.length === 10 || d.length === 11;
}

/** Máscara de CEP enquanto digita: 01310-100. */
export function maskCep(value: string) {
  return onlyDigits(value).slice(0, 8).replace(/(\d{5})(\d{1,3})$/, "$1-$2");
}

/** CEP plausível: 8 dígitos. Se existe de verdade, quem diz é a busca. */
export function isValidCep(value: string) {
  return onlyDigits(value).length === 8;
}

export const BRAZILIAN_STATES = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO",
  "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI",
  "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;

export const BUSINESS_SEGMENTS = [
  { value: "estetica_beleza", label: "Estética e beleza" },
  { value: "saude_clinicas", label: "Saúde e clínicas" },
  { value: "advocacia", label: "Advocacia" },
  { value: "imobiliaria", label: "Imobiliária" },
  { value: "educacao", label: "Educação e cursos" },
  { value: "varejo_loja", label: "Varejo / loja" },
  { value: "alimentacao", label: "Alimentação" },
  { value: "servicos_gerais", label: "Serviços em geral" },
  { value: "outro", label: "Outro" },
] as const;

export const REFERRAL_SOURCES = [
  { value: "indicacao", label: "Indicação" },
  { value: "google", label: "Google" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "outro", label: "Outro" },
] as const;

/**
 * Valores que abrem um campo de texto livre ao serem escolhidos. "Outro" só
 * qualifica o lead se a pessoa puder dizer *qual* — sem isso o dado vira uma
 * gaveta que ninguém consegue ler depois.
 */
export const OTHER_VALUE = "outro";

/** Quantos caracteres o texto de "Outro" aceita — cabe uma resposta, não um texto. */
export const OTHER_DETAIL_MAX = 80;
