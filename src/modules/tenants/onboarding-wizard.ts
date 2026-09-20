// Onboarding guiado (/onboarding) — wizard completo para o usuário comum (OWNER).
//
// Este módulo é a fonte única de verdade do wizard e é importado TANTO pelo
// client component (UI/validação otimista) QUANTO pelas server actions
// (validação real antes de gravar). Por isso não pode importar prisma nem
// nada marcado com "server-only".
//
// Linguagem: tudo voltado ao usuário leigo — nada de "prompt", "LLM", "tool".

import { z } from "zod";
import { ACTION_BY_KEY, type ActionKey } from "@/modules/agent-engine/actions";
import type { PersonaAnswers } from "@/modules/agent-engine/persona";

/* ------------------------------------------------------------------ passos */

export type StepNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const ONBOARDING_STEPS = [
  {
    n: 1 as const,
    label: "Boas-vindas",
    title: "Vamos colocar seu atendente para trabalhar",
    subtitle: "Você vai configurar cada parte do agente. Dá pra parar e continuar depois.",
  },
  {
    n: 2 as const,
    label: "Jeito e objetivo",
    title: "Defina o jeito e o objetivo do seu atendente",
    subtitle: "Defina o jeito de falar e o resultado principal. As tarefas que ele pode executar vêm no próximo passo.",
  },
  {
    n: 3 as const,
    label: "Regras",
    title: "O que ele nunca deve fazer?",
    subtitle: "Defina limites claros para evitar promessas, respostas ou decisões que não combinam com seu negócio.",
  },
  {
    n: 4 as const,
    label: "Cérebro",
    title: "O que ele precisa saber?",
    subtitle: "Adicione preços, horários, serviços e respostas frequentes para ele consultar durante as conversas.",
  },
  {
    n: 5 as const,
    label: "Habilidades",
    title: "O que ele pode fazer sozinho?",
    subtitle: "Escolha as tarefas práticas que ele tem permissão para executar e entenda o efeito de cada uma.",
  },
  {
    n: 6 as const,
    label: "Comportamento",
    title: "Como ele deve agir durante a conversa?",
    subtitle: "Escolha como o agente lida com áudios e quando um atendente humano assume o contato.",
  },
  {
    n: 7 as const,
    label: "Conectar",
    title: "Onde as pessoas vão falar com ele",
    subtitle: "Conecte agora ou deixe para depois — seu atendente já está pronto.",
  },
];

export const FIRST_STEP: StepNumber = 1;
export const LAST_STEP: StepNumber = 7;

export function isStepNumber(n: unknown): n is StepNumber {
  return n === 1 || n === 2 || n === 3 || n === 4 || n === 5 || n === 6 || n === 7;
}

/* ------------------------------------------------- opções de personalidade */

/** Tom de voz — o `value` vai literal para o comportamento do agente. */
export const TONE_OPTIONS = [
  { value: "Amigável e próximo", hint: "Conversa leve, como um bom atendente de loja." },
  { value: "Profissional e direto", hint: "Vai direto ao ponto, sem rodeios." },
  { value: "Acolhedor e paciente", hint: "Explica com calma. Bom para quem tem muitas dúvidas." },
  { value: "Animado e entusiasmado", hint: "Energia alta. Combina com vendas." },
];

/** Objetivo principal da conversa. */
export const OBJECTIVE_OPTIONS = [
  {
    value: "Agendar um horário",
    label: "Conseguir um agendamento",
    hint: "Resultado esperado: terminar a conversa com dia e hora combinados.",
  },
  {
    value: "Fechar uma venda",
    label: "Levar a pessoa à compra",
    hint: "Resultado esperado: avançar a conversa até a decisão de compra.",
  },
  {
    value: "Entender o que a pessoa precisa",
    label: "Qualificar o contato",
    hint: "Resultado esperado: descobrir a necessidade, o momento e o interesse da pessoa.",
  },
  {
    value: "Tirar dúvidas sobre o serviço",
    label: "Ajudar a pessoa a decidir",
    hint: "Resultado esperado: resolver as dúvidas que impedem a decisão.",
  },
];

/* ---------------------------------------------------- processos / fluxos */

export type ProcessKey =
  | "atendimento"
  | "vendas"
  | "suporte"
  | "agendamento"
  | "follow_up"
  | "triagem";

export type ProcessDef = {
  key: ProcessKey;
  label: string;
  description: string;
  /** Automações do catálogo que este processo liga (ver agent-engine/actions). */
  actionKeys: ActionKey[];
};

export const PROCESS_CATALOG: ProcessDef[] = [
  {
    key: "atendimento",
    label: "Responder dúvidas e salvar o contato",
    description: "Informa preço, horário e como funciona, além de registrar os dados da pessoa.",
    actionKeys: ["register_lead"],
  },
  {
    key: "vendas",
    label: "Identificar oportunidades de venda",
    description: "Apresenta o que você oferece e avisa quando alguém demonstra intenção de comprar.",
    actionKeys: ["register_lead", "mark_hot_lead"],
  },
  {
    key: "suporte",
    label: "Atender clientes e chamar seu time",
    description: "Ajuda com problemas e transfere a conversa quando precisar de uma pessoa.",
    actionKeys: ["handoff_human"],
  },
  {
    key: "agendamento",
    label: "Consultar a agenda e marcar horários",
    description: "Mostra horários realmente livres e confirma a escolha sem você entrar na conversa.",
    actionKeys: ["schedule_meeting"],
  },
  {
    key: "follow_up",
    label: "Retomar contatos que pararam de responder",
    description: "Envia uma nova mensagem depois do intervalo escolhido, mas não insiste após um agendamento.",
    actionKeys: ["follow_up"],
  },
  {
    key: "triagem",
    label: "Encerrar contatos que não são clientes",
    description: "Identifica vendedor, trote ou pedido fora da sua área e encerra a conversa com educação.",
    actionKeys: ["disqualify_lead"],
  },
];

export const PROCESS_KEYS = PROCESS_CATALOG.map((p) => p.key) as [ProcessKey, ...ProcessKey[]];

export const PROCESS_BY_KEY = Object.fromEntries(PROCESS_CATALOG.map((p) => [p.key, p])) as Record<
  ProcessKey,
  ProcessDef
>;

/* ------------------------------------------------------------------ draft */

export type OnboardingDraft = {
  agentName: string;
  tone: string;
  objective: string;
  rules: string;
  processes: ProcessKey[];
  customProcess: string;
  listenAudio: boolean;
  stopOnEmoji: boolean;
};

export const EMPTY_DRAFT: OnboardingDraft = {
  agentName: "",
  tone: "",
  objective: "",
  rules: "",
  processes: [],
  customProcess: "",
  listenAudio: true,
  stopOnEmoji: true,
};

export const draftSchema = z.object({
  agentName: z.string().trim().max(40).default(""),
  tone: z.string().trim().max(120).default(""),
  objective: z.string().trim().max(160).default(""),
  rules: z.string().trim().max(4000).default(""),
  processes: z.array(z.enum(PROCESS_KEYS)).default([]),
  customProcess: z.string().trim().max(240).default(""),
  listenAudio: z.boolean().default(true),
  stopOnEmoji: z.boolean().default(true),
});

/** Lê um draft vindo do banco (Json) ou do client, sempre devolvendo algo utilizável. */
export function parseDraft(raw: unknown): OnboardingDraft {
  const parsed = draftSchema.safeParse(raw ?? {});
  if (!parsed.success) return { ...EMPTY_DRAFT };
  // dedup defensivo: o client pode mandar a mesma chave duas vezes
  return { ...parsed.data, processes: [...new Set(parsed.data.processes)] };
}

/* -------------------------------------------------------------- validação */

export type StepErrors = Partial<Record<keyof OnboardingDraft, string>>;

/**
 * Valida o que o passo exige para liberar o "Continuar".
 * Só personalidade e habilidades travam. Regras e Cérebro são opcionais, os
 * comportamentos já têm padrões seguros e a integração pode ficar para depois.
 */
export function validateStep(step: StepNumber, draft: OnboardingDraft): StepErrors {
  const errors: StepErrors = {};

  if (step === 2) {
    if (draft.agentName.trim().length < 2) {
      errors.agentName = "Dê um nome ao seu atendente (pelo menos 2 letras).";
    }
    if (!draft.tone.trim()) {
      errors.tone = "Escolha como ele deve falar.";
    }
    if (!draft.objective.trim()) {
      errors.objective = "Escolha o resultado principal que ele deve buscar.";
    }
  }

  if (step === 5 && draft.processes.length === 0 && !draft.customProcess.trim()) {
    errors.processes = "Escolha pelo menos uma tarefa que ele pode executar.";
  }

  return errors;
}

export function isStepValid(step: StepNumber, draft: OnboardingDraft): boolean {
  return Object.keys(validateStep(step, draft)).length === 0;
}

/** O wizard só pode ser concluído se todos os passos que travam estiverem ok. */
export function canComplete(draft: OnboardingDraft): boolean {
  return isStepValid(2, draft) && isStepValid(5, draft);
}

/* ------------------------------------------------- tradução para o domínio */

/**
 * Converte os processos escolhidos nas automações do catálogo, respeitando o
 * limite do plano (mesma regra do toggle em /agentes). Sem dedup o FREE
 * estouraria já na primeira combinação.
 */
export function resolveActionKeys(draft: OnboardingDraft, limit: number): ActionKey[] {
  const keys: ActionKey[] = [];
  for (const p of draft.processes) {
    for (const key of PROCESS_BY_KEY[p]?.actionKeys ?? []) {
      if (keys.includes(key)) continue;
      if (ACTION_BY_KEY[key]?.status === "disabled") continue;
      keys.push(key);
    }
  }
  return keys.slice(0, Math.max(0, limit));
}

/** Quantas automações ficariam de fora pelo limite do plano (0 = cabe tudo). */
export function countActionsOverLimit(draft: OnboardingDraft, limit: number): number {
  const wanted = new Set<ActionKey>();
  for (const p of draft.processes) {
    for (const key of PROCESS_BY_KEY[p]?.actionKeys ?? []) {
      if (ACTION_BY_KEY[key]?.status === "disabled") continue;
      wanted.add(key);
    }
  }
  return Math.max(0, wanted.size - Math.max(0, limit));
}

/** Descrição em linguagem simples do que o agente cobre (vai para o comportamento). */
export function describeProcesses(draft: OnboardingDraft): string {
  const parts = draft.processes.map((p) => PROCESS_BY_KEY[p]?.label ?? p);
  if (draft.customProcess.trim()) parts.push(draft.customProcess.trim());
  return parts.join("; ");
}

/**
 * Traduz as respostas do wizard para o formato de persona já usado em
 * /agentes — assim o que o usuário definiu aqui aparece lá para edição,
 * em vez de virar um estado paralelo.
 */
export function draftToPersona(draft: OnboardingDraft, businessName: string): PersonaAnswers {
  return {
    agentName: draft.agentName.trim(),
    businessName: businessName.trim(),
    sector: "",
    tone: draft.tone.trim(),
    writingStyle: "",
    offer: describeProcesses(draft),
    avoid: draft.rules.trim(),
    objective: draft.objective.trim(),
  };
}
