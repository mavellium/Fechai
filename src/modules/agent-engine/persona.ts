// Wizard de persona: perguntas guiadas -> system prompt. Nada hardcoded de
// segmento; tudo vem das respostas do usuário.
export type PersonaField = {
  name: keyof PersonaAnswers;
  label: string;
  placeholder: string;
  type: "text" | "textarea";
};

export type PersonaAnswers = {
  agentName: string;
  businessName: string;
  sector: string;
  tone: string;
  offer: string;
  avoid: string;
  objective: string;
};

export const PERSONA_FIELDS: PersonaField[] = [
  { name: "agentName", label: "Nome do agente", placeholder: "Ex: Aurora", type: "text" },
  { name: "businessName", label: "Nome do negócio", placeholder: "Ex: Estúdio Aurora", type: "text" },
  { name: "sector", label: "Segmento / o que você faz", placeholder: "Ex: estúdio de pilates", type: "text" },
  { name: "tone", label: "Tom de voz", placeholder: "Ex: acolhedor, profissional, direto", type: "text" },
  {
    name: "offer",
    label: "O que o agente deve oferecer/explicar",
    placeholder: "Ex: aulas experimentais, planos mensais, horários",
    type: "textarea",
  },
  {
    name: "avoid",
    label: "O que o agente NÃO deve fazer",
    placeholder: "Ex: não prometer descontos, não dar diagnóstico médico",
    type: "textarea",
  },
  {
    name: "objective",
    label: "Objetivo da conversa",
    placeholder: "Ex: agendar uma aula experimental",
    type: "text",
  },
];

export function composeSystemPrompt(a: PersonaAnswers): string {
  const parts = [
    a.agentName
      ? `Você se chama ${a.agentName} e é o atendente virtual de ${a.businessName || "um negócio"}${a.sector ? `, do segmento: ${a.sector}` : ""}. Apresente-se pelo nome no primeiro contato.`
      : `Você é o atendente virtual de ${a.businessName || "um negócio"}${a.sector ? `, do segmento: ${a.sector}` : ""}.`,
    a.tone ? `Tom de voz: ${a.tone}.` : "",
    "Responda com base APENAS na base de conhecimento fornecida. Se não souber, diga que vai verificar e ofereça encaminhar a um humano.",
    a.offer ? `Você deve oferecer/explicar: ${a.offer}.` : "",
    a.avoid ? `Você NÃO deve: ${a.avoid}.` : "",
    "Seja objetivo e comercial. Colete os dados do contato quando fizer sentido e use as ações disponíveis.",
  ];
  return parts.filter(Boolean).join("\n");
}
