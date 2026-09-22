import { describe, expect, it } from "vitest";
import {
  splitSummaryAndVariables,
  variableExtractionPrompt,
} from "@/modules/agent-engine/summary-variables";

const definitions = [
  { key: "nome", description: "Nome da pessoa que está conversando;" },
  { key: "endereco", description: "Endereço informado pelo contato." },
  { key: "convenio", description: "Convênio informado pelo contato." },
];

const resumo = "O que o cliente quer: remarcar\nOnde parou: aguardando horário";

describe("instrução de extração", () => {
  it("lista as variáveis pedidas e proíbe deduzir", () => {
    const prompt = variableExtractionPrompt(definitions);
    expect(prompt).toContain("<variaveis>");
    expect(prompt).toContain("- convenio:");
    expect(prompt).toContain("não informado");
    expect(prompt).toContain("nunca deduza");
  });

  it("não pede bloco nenhum quando não há o que preencher", () => {
    expect(variableExtractionPrompt([])).toBe("");
  });
});

describe("separação do resumo e dos valores", () => {
  it("extrai os valores e tira o bloco do texto lido pelo dono da conta", () => {
    const { summary, values } = splitSummaryAndVariables(
      `${resumo}\n<variaveis>\nnome: Tangerina\nendereco: Rua das Flores, 120\n</variaveis>`,
      definitions,
    );
    expect(values).toEqual({ nome: "Tangerina", endereco: "Rua das Flores, 120" });
    expect(summary).toBe(resumo);
    expect(summary).not.toContain("variaveis");
  });

  it('ignora o que o modelo não encontrou em vez de gravar "não informado"', () => {
    const { values } = splitSummaryAndVariables(
      `${resumo}\n<variaveis>\nnome: não informado\nendereco: -\nconvenio: N/A\n</variaveis>`,
      definitions,
    );
    expect(values).toEqual({});
  });

  it("recusa chave fora da lista e o número, que é do sistema", () => {
    const { values } = splitSummaryAndVariables(
      `${resumo}\n<variaveis>\nnumero: 5511999999999\nsegredo: x\nconvenio: Plano Azul\n</variaveis>`,
      definitions,
    );
    expect(values).toEqual({ convenio: "Plano Azul" });
  });

  it("devolve o resumo inteiro quando o modelo não escreve o bloco", () => {
    const { summary, values } = splitSummaryAndVariables(resumo, definitions);
    expect(summary).toBe(resumo);
    expect(values).toEqual({});
  });

  it("não deixa bloco malformado custar o resumo", () => {
    const { summary, values } = splitSummaryAndVariables(
      `${resumo}\n<variaveis>\nlinha sem dois pontos\n</variaveis>`,
      definitions,
    );
    expect(summary).toBe(resumo);
    expect(values).toEqual({});
  });

  it("limpa aspas e recusa token de variável como valor", () => {
    const { values } = splitSummaryAndVariables(
      `${resumo}\n<variaveis>\nnome: "Maria"\nendereco: {{endereco}}\n</variaveis>`,
      definitions,
    );
    expect(values).toEqual({ nome: "Maria" });
  });
});
