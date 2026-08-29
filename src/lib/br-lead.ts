/**
 * Dados de qualificação do lead capturados no /cadastro: validação e máscara
 * de CPF/CNPJ e telefone, e as listas de opções dos selects (gênero, UF,
 * segmento de negócio, como conheceu o fechai). Um módulo só porque o
 * formulário de cadastro e a rota `/api/register` precisam da mesma regra —
 * duas cópias divergentes deixariam passar no cliente o que o servidor rejeita.
 */

/** Mantém só dígitos — é como CPF/CNPJ e telefone são guardados no banco. */
export function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

/**
 * Dígitos verificadores do CPF (algoritmo do módulo 11 da Receita Federal).
 * Também rejeita sequências repetidas ("00000000000"), que passariam no
 * cálculo mas nunca são CPFs reais.
 */
export function isValidCPF(digits: string) {
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(digits[i]) * (len + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return calc(9) === Number(digits[9]) && calc(10) === Number(digits[10]);
}

/** Dígitos verificadores do CNPJ (mesma ideia do CPF, pesos diferentes). */
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

/** CPF (11 dígitos) ou CNPJ (14) — o único campo "documento" do cadastro. */
export function isValidCpfCnpj(value: string) {
  const digits = onlyDigits(value);
  return digits.length === 11 ? isValidCPF(digits) : digits.length === 14 ? isValidCNPJ(digits) : false;
}

/** Máscara progressiva enquanto digita: cresce de CPF pra CNPJ com o tamanho. */
export function maskCpfCnpj(value: string) {
  const d = onlyDigits(value).slice(0, 14);
  if (d.length <= 11) {
    return d
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  }
  return d
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

export const GENDER_OPTIONS = [
  { value: "feminino", label: "Feminino" },
  { value: "masculino", label: "Masculino" },
  { value: "outro", label: "Outro" },
  { value: "prefiro_nao_informar", label: "Prefiro não informar" },
] as const;

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
