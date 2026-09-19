import { describe, expect, it } from "vitest";
import { isValidCnpj, isValidCep, maskCnpj, maskCep, onlyDigits } from "@/lib/br-lead";

/**
 * O /cadastro aceita **apenas empresas**. O que estes testes protegem é a
 * fronteira: CPF válido é um documento real que precisa ser recusado aqui, e é
 * exatamente o caso que uma checagem preguiçosa ("11 ou 14 dígitos") deixaria
 * passar de volta sem ninguém perceber.
 */
describe("documento do cadastro — só CNPJ", () => {
  it.each([
    ["11.222.333/0001-81", true],
    ["11222333000181", true],
    // CPFs válidos de verdade: o algoritmo do CPF passa neles, o do CNPJ não.
    ["529.982.247-25", false],
    ["52998224725", false],
    // Sequência repetida: passa no módulo 11, nunca é um CNPJ real.
    ["11.111.111/1111-11", false],
    ["11.222.333/0001-80", false], // dígito verificador trocado
    ["", false],
    ["1122233300018", false], // 13 dígitos
  ])("%s → %s", (value, expected) => {
    expect(isValidCnpj(value)).toBe(expected);
  });

  it("mascara enquanto digita e guarda só dígitos", () => {
    expect(maskCnpj("11222333000181")).toBe("11.222.333/0001-81");
    expect(maskCnpj("112223")).toBe("11.222.3");
    // Passar de 14 dígitos não escorre para dentro do campo.
    expect(onlyDigits(maskCnpj("112223330001812345"))).toHaveLength(14);
  });
});

describe("CEP", () => {
  it.each([
    ["01310-100", true],
    ["01310100", true],
    ["0131010", false], // 7 dígitos
    ["", false],
  ])("%s → %s", (value, expected) => {
    expect(isValidCep(value)).toBe(expected);
  });

  it("mascara enquanto digita", () => {
    expect(maskCep("01310100")).toBe("01310-100");
    expect(maskCep("013101009999")).toBe("01310-100");
  });
});
