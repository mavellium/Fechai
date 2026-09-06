import { describe, it, expect } from "vitest";
import {
  firstEnabledIndex,
  lastEnabledIndex,
  stepIndex,
} from "@/components/ui/select-menu-nav";

/**
 * O `SelectMenu` substitui um `<select>` nativo, que já vinha com teclado
 * pronto. Estes testes cobrem a parte que passou a ser nossa: andar entre as
 * opções sem cair em opção desabilitada e sem travar nas pontas.
 */
describe("navegação por teclado do SelectMenu", () => {
  const opcoes = [{}, {}, {}, {}, {}]; // 5 opções, todas habilitadas

  it("anda para frente e para trás", () => {
    expect(stepIndex(0, 1, opcoes)).toBe(1);
    expect(stepIndex(2, -1, opcoes)).toBe(1);
  });

  it("dá a volta nas duas pontas", () => {
    // Sem o ajuste de módulo negativo, ir para trás no índice 0 daria -1 e a
    // seta para cima simplesmente não funcionaria na primeira opção.
    expect(stepIndex(0, -1, opcoes)).toBe(4);
    expect(stepIndex(4, 1, opcoes)).toBe(0);
  });

  it("pula opções desabilitadas", () => {
    const comBuraco = [{}, { disabled: true }, { disabled: true }, {}, {}];
    expect(stepIndex(0, 1, comBuraco)).toBe(3);
    expect(stepIndex(3, -1, comBuraco)).toBe(0);
  });

  it("pula desabilitada também ao dar a volta", () => {
    const ultimaDesabilitada = [{}, {}, { disabled: true }];
    expect(stepIndex(1, 1, ultimaDesabilitada)).toBe(0);
  });

  it("fica onde está quando nenhuma outra opção é escolhível", () => {
    const soUma = [{ disabled: true }, {}, { disabled: true }];
    expect(stepIndex(1, 1, soUma)).toBe(1);
    expect(stepIndex(1, -1, soUma)).toBe(1);
  });

  it("não quebra com lista vazia", () => {
    expect(stepIndex(0, 1, [])).toBe(0);
  });

  it("Home e End param na primeira/última habilitada", () => {
    const pontasDesabilitadas = [{ disabled: true }, {}, {}, { disabled: true }];
    expect(firstEnabledIndex(pontasDesabilitadas)).toBe(1);
    expect(lastEnabledIndex(pontasDesabilitadas)).toBe(2);
  });

  it("Home e End funcionam com todas habilitadas", () => {
    expect(firstEnabledIndex(opcoes)).toBe(0);
    expect(lastEnabledIndex(opcoes)).toBe(4);
  });
});
