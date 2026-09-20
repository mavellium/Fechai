import { describe, expect, it } from "vitest";
import {
  OBJECTIVE_OPTIONS,
  ONBOARDING_STEPS,
  PROCESS_CATALOG,
  draftToPersona,
  parseDraft,
} from "@/modules/tenants/onboarding-wizard";

describe("onboarding completo e claro do agente", () => {
  it("apresenta todas as áreas necessárias antes de conectar", () => {
    expect(ONBOARDING_STEPS.map((step) => step.label)).toEqual([
      "Boas-vindas",
      "Jeito e objetivo",
      "Regras",
      "Cérebro",
      "Habilidades",
      "Comportamento",
      "Conectar",
    ]);
    expect(ONBOARDING_STEPS[1]).toMatchObject({
      label: "Jeito e objetivo",
      title: "Defina o jeito e o objetivo do seu atendente",
    });
    expect(ONBOARDING_STEPS[4]).toMatchObject({
      label: "Habilidades",
      title: "O que ele pode fazer sozinho?",
    });
  });

  it("explica cada objetivo como resultado esperado", () => {
    expect(OBJECTIVE_OPTIONS.every((option) => option.hint.startsWith("Resultado esperado:"))).toBe(true);
    expect(OBJECTIVE_OPTIONS.every((option) => option.label.length > 0)).toBe(true);
  });

  it("preserva os valores salvos dos objetivos apesar dos novos rótulos", () => {
    expect(OBJECTIVE_OPTIONS.map((option) => option.value)).toEqual([
      "Agendar um horário",
      "Fechar uma venda",
      "Entender o que a pessoa precisa",
      "Tirar dúvidas sobre o serviço",
    ]);
  });

  it("descreve processos como tarefas concretas", () => {
    expect(PROCESS_CATALOG.map((process) => process.label)).toEqual([
      "Responder dúvidas e salvar o contato",
      "Identificar oportunidades de venda",
      "Atender clientes e chamar seu time",
      "Consultar a agenda e marcar horários",
      "Retomar contatos que pararam de responder",
      "Encerrar contatos que não são clientes",
    ]);
  });

  it("mantém rascunhos antigos compatíveis com os novos passos", () => {
    const draft = parseDraft({
      agentName: "Aurora",
      tone: "Profissional e direto",
      objective: "Agendar um horário",
      processes: ["agendamento"],
      customProcess: "",
    });
    expect(draft).toMatchObject({ rules: "", listenAudio: true, stopOnEmoji: true });
  });

  it("leva as regras do onboarding para a persona real do agente", () => {
    const draft = parseDraft({
      agentName: "Aurora",
      tone: "Profissional e direto",
      objective: "Agendar um horário",
      rules: "Não prometer desconto",
      processes: ["agendamento"],
      customProcess: "",
    });
    expect(draftToPersona(draft, "Clínica Aurora").avoid).toBe("Não prometer desconto");
  });
});
