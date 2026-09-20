import { describe, expect, it } from "vitest";
import {
  PERSONA_FIELDS,
  composeSystemPrompt,
  type PersonaAnswers,
} from "@/modules/agent-engine/persona";

const answers: PersonaAnswers = {
  agentName: "Aurora",
  businessName: "Clínica Aurora",
  sector: "odontologia",
  tone: "acolhedor e profissional",
  writingStyle: "frases curtas, poucos emojis e sem listas longas",
  offer: "consultas e tratamentos",
  avoid: "Não dar diagnóstico sem avaliação",
  objective: "agendar uma consulta",
};

describe("estilo de escrita da persona", () => {
  it("exibe um único campo dentro de Como ele fala", () => {
    const fields = PERSONA_FIELDS.filter((field) => field.name === "writingStyle");
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({
      label: "Estilo de escrita",
      group: "comportamento",
    });
  });

  it("inclui o estilo de escrita no briefing do agente", () => {
    expect(composeSystemPrompt(answers)).toContain(
      "Estilo de escrita: frases curtas, poucos emojis e sem listas longas.",
    );
  });

  it("não cria uma instrução vazia para contas antigas", () => {
    expect(composeSystemPrompt({ ...answers, writingStyle: "" })).not.toContain(
      "Estilo de escrita:",
    );
  });
});
