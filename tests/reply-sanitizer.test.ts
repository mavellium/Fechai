import { describe, expect, it } from "vitest";

import { sanitizeUnresolvedPlaceholders } from "@/modules/agent-engine/reply-sanitizer";

describe("proteção contra variáveis não substituídas", () => {
  it("remove [Nome] sem deixar pontuação quebrada", () => {
    expect(
      sanitizeUnresolvedPlaceholders(
        "Entendo, [Nome]! 😊 Fico à disposição caso mude de ideia.",
      ),
    ).toBe("Entendo! 😊 Fico à disposição caso mude de ideia.");

    expect(sanitizeUnresolvedPlaceholders("Olá [nome], tudo bem?")).toBe(
      "Olá, tudo bem?",
    );
  });

  it("remove variáveis com descrição e chaves duplas", () => {
    expect(
      sanitizeUnresolvedPlaceholders(
        "Paciente: [Nome Completo coletado no chat] — telefone {{phone_number}}.",
      ),
    ).toBe("Paciente: — telefone.");
  });

  it("mantém colchetes legítimos e links Markdown", () => {
    const reply = "Veja [os horários](https://exemplo.com) e escolha [segunda-feira].";
    expect(sanitizeUnresolvedPlaceholders(reply)).toBe(reply);
  });

  it("não reescreve uma resposta comum", () => {
    expect(sanitizeUnresolvedPlaceholders("oi, tudo bem?")).toBe("oi, tudo bem?");
  });

  it("permite o fallback quando só havia uma variável", () => {
    expect(sanitizeUnresolvedPlaceholders("[Nome]")).toBe("");
  });

  it("substitui valores conhecidos e omite os que faltam", () => {
    expect(sanitizeUnresolvedPlaceholders("Oi {{nome}}! Endereço: {{endereco}}.", { nome: "Alcides" }))
      .toBe("Oi Alcides!");
    expect(sanitizeUnresolvedPlaceholders("{{endereco}}", {})).toBe("");
    expect(sanitizeUnresolvedPlaceholders("Oi {{nome}}", { nome: "{{desconhecida}}" })).toBe("Oi");
  });
});
