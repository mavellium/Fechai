// Wizard de persona: perguntas guiadas -> system prompt. Nada hardcoded de
// segmento; tudo vem das respostas do usuário.
export type PersonaField = {
  name: keyof PersonaAnswers;
  label: string;
  placeholder: string;
  type: "text" | "textarea";
  /**
   * O que responder aqui, em uma frase. Os sete campos eram só rótulo +
   * placeholder: dava para preencher tudo sem entender que aquilo vira o
   * comportamento do agente, e o resultado era persona genérica.
   */
  hint: string;
  /** Em qual bloco do formulário o campo aparece. */
  group: PersonaGroup;
};

export type PersonaGroup = "identidade" | "comportamento" | "objetivo";

/** Blocos do formulário de persona, na ordem em que são preenchidos. */
export const PERSONA_GROUPS: { key: PersonaGroup; legend: string; hint: string }[] = [
  {
    key: "identidade",
    legend: "1. Quem ele é",
    hint: "O nome que o agente usa ao se apresentar e o negócio que ele representa.",
  },
  {
    key: "comportamento",
    legend: "2. Como ele fala",
    hint: "O tom e os assuntos que ele puxa sozinho. Limites do que ele NUNCA deve fazer ficam no passo Regras.",
  },
  {
    key: "objetivo",
    legend: "3. Onde a conversa deve chegar",
    hint: "O que conta como sucesso em um atendimento. O agente conduz para isso.",
  },
];

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
  {
    name: "agentName",
    label: "Nome do agente",
    placeholder: "Ex: Aurora",
    type: "text",
    hint: "É assim que ele se apresenta: “Oi, aqui é a Aurora”. Deixe em branco para ele não usar nome.",
    group: "identidade",
  },
  {
    name: "businessName",
    label: "Nome do negócio",
    placeholder: "Ex: Estúdio Aurora",
    type: "text",
    hint: "O nome que o cliente conhece — o mesmo da fachada, do Instagram, da nota.",
    group: "identidade",
  },
  {
    name: "sector",
    label: "Segmento / o que você faz",
    placeholder: "Ex: estúdio de pilates",
    type: "text",
    hint: "Uma linha sobre o negócio. Ajuda o agente a entender o vocabulário do seu cliente.",
    group: "identidade",
  },
  {
    name: "tone",
    label: "Tom de voz",
    placeholder: "Ex: acolhedor, profissional, direto",
    type: "text",
    hint: "Duas ou três palavras bastam. Pense em como um bom funcionário seu atenderia.",
    group: "comportamento",
  },
  {
    name: "offer",
    label: "O que o agente deve oferecer/explicar",
    placeholder: "Ex: aulas experimentais, planos mensais, horários",
    type: "textarea",
    hint: "Os assuntos que ele puxa sozinho. Preço, regra e detalhe fino ficam na Base de conhecimento — o passo seguinte.",
    group: "comportamento",
  },
  {
    name: "objective",
    label: "Objetivo da conversa",
    placeholder: "Ex: agendar uma aula experimental",
    type: "text",
    hint: "O que você quer que aconteça no fim. O agente conduz a conversa para esse desfecho.",
    group: "objetivo",
  },
];

/** `avoid` guarda uma regra por linha (ver RulesForm) — aqui vira lista com marcadores. */
function formatRules(avoid: string): string {
  const rules = avoid
    .split("\n")
    .map((r) => r.trim())
    .filter(Boolean);
  if (rules.length === 0) return "";
  return `Regras que você deve seguir sempre:\n${rules.map((r) => `- ${r}`).join("\n")}`;
}

export function composeSystemPrompt(a: PersonaAnswers): string {
  const parts = [
    a.agentName
      ? `Você se chama ${a.agentName} e é o atendente virtual de ${a.businessName || "um negócio"}${a.sector ? `, do segmento: ${a.sector}` : ""}. Apresente-se pelo nome no primeiro contato.`
      : `Você é o atendente virtual de ${a.businessName || "um negócio"}${a.sector ? `, do segmento: ${a.sector}` : ""}.`,
    a.tone ? `Tom de voz: ${a.tone}.` : "",
    "Responda com base APENAS na base de conhecimento fornecida. Se não souber, diga que vai verificar e ofereça encaminhar a um humano.",
    a.offer ? `Você deve oferecer/explicar: ${a.offer}.` : "",
    formatRules(a.avoid),
    "Seja objetivo e comercial. Colete os dados do contato quando fizer sentido e use as ações disponíveis.",
  ];
  return parts.filter(Boolean).join("\n");
}
