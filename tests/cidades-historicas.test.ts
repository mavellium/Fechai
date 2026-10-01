import { describe, expect, it } from "vitest";
import { declaredCity } from "@/modules/lead-insights/historical-city";
const msg = (content: string, role = "user") => ({ id: "message-id", content, role, createdAt: new Date("2026-08-01T12:00:00Z") });

describe("cidade histórica: somente declaração explícita do contato", () => {
  it.each(["Sou de Marília", "moro em Garça", "Eu sou de marilia - SP.", "Minha cidade é São Paulo", "Resido em Tupã", "Sou de Marília, gostaria de saber o preço"])("reconhece %s", (text) => {
    expect(declaredCity(msg(text))).toMatchObject({ messageId: "message-id", declaredAt: msg(text).createdAt });
  });
  it("reconhece resposta curta só com pergunta sobre a cidade do contato", () => {
    expect(declaredCity(msg("Garça"), msg("Qual sua cidade?", "assistant"))).toMatchObject({ cityKey: "garca" });
    expect(declaredCity(msg("Marília"), msg("Você é de qual cidade?", "assistant"))).toMatchObject({ cityKey: "marilia" });
    expect(declaredCity(msg("Garça"))).toBeNull();
    expect(declaredCity(msg("Garça"), msg("Qual cidade fica nossa clínica?", "assistant"))).toBeNull();
  });
  it.each(["Não sou de Marília", "Minha irmã mora em Garça", "Quero agendar em Marília", "Moro na Rua Marília 27",
    "DDD 14", "Sou de uma cidade perto de Garça", "Sou de Marilha", "Sou de Nenhuma Cidade", "Sou de Marília e não de Garça"])("não inventa cidade em %s", (text) => {
    expect(declaredCity(msg(text))).toBeNull();
  });
  it("não toma a fala da clínica como a localização do contato", () => {
    expect(declaredCity(msg("Sou de Marília", "assistant"))).toBeNull();
    expect(declaredCity(msg("sim"), msg("Você é de Marília?", "assistant"))).toBeNull();
  });
});
