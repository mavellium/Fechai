import { describe, it, expect } from "vitest";
import { filterUsable, type ChainStep } from "@/modules/ai/chain";

/**
 * Seleção de degraus da cadeia de fallback da IA.
 *
 * É a decisão mais fácil de errar de um jeito que não aparece em teste manual:
 * uma quarentena mal filtrada ou deixa o agente batendo numa chave esgotada a
 * cada mensagem, ou — pior — devolve lista vazia e cala o agente por completo.
 */
const NOW = new Date("2026-09-06T12:00:00Z");

function step(id: string, cooldownUntil: Date | null = null): ChainStep {
  return {
    id,
    // O modelo em si não importa para esta decisão; só a quarentena.
    model: { id, provider: "groq", label: id } as ChainStep["model"],
    credentialId: null,
    credentialLabel: null,
    cooldownUntil,
  };
}

const antes = new Date(NOW.getTime() - 60_000);
const depois = new Date(NOW.getTime() + 60_000);

describe("cadeia de fallback: quais degraus podem ser usados", () => {
  it("mantém a ordem configurada quando ninguém está de molho", () => {
    const chain = [step("a"), step("b"), step("c")];
    expect(filterUsable(chain, NOW).map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("pula o degrau em quarentena", () => {
    const chain = [step("a", depois), step("b"), step("c")];
    expect(filterUsable(chain, NOW).map((s) => s.id)).toEqual(["b", "c"]);
  });

  it("readmite quem já cumpriu a quarentena", () => {
    // Quarentena vencida (no passado) não pode continuar excluindo a chave —
    // senão ela nunca voltaria a ser usada depois que a cota renovasse.
    const chain = [step("a", antes), step("b")];
    expect(filterUsable(chain, NOW).map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("devolve a cadeia inteira quando TODOS estão de molho", () => {
    // O caso que decide se o agente fala ou fica mudo: melhor tentar uma chave
    // provavelmente esgotada do que não responder ao lead.
    const chain = [step("a", depois), step("b", depois)];
    expect(filterUsable(chain, NOW).map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("trata quarentena que expira exatamente agora como liberada", () => {
    const chain = [step("a", NOW), step("b")];
    expect(filterUsable(chain, NOW).map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("não inventa degraus quando a cadeia está vazia", () => {
    expect(filterUsable([], NOW)).toEqual([]);
  });
});
