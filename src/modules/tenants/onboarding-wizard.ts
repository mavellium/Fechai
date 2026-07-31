// Onboarding guiado (/onboarding) — wizard de 4 passos para o usuário comum (OWNER).
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

export type StepNumber = 1 | 2 | 3 | 4;

export const ONBOARDING_STEPS = [
  {
    n: 1 as const,
    label: "Boas-vindas",
    title: "Vamos colocar seu atendente para trabalhar",
    subtitle: "São 4 passos rápidos. Dá pra parar e continuar depois.",
  },
  {
    n: 2 as const,
    label: "Seu atendente",
    title: "Como seu atendente deve ser?",
    subtitle: "Isso define o jeito que ele fala com quem chega.",
  },
  {
    n: 3 as const,
    label: "O que ele faz",
    title: "O que seu atendente vai resolver?",
    subtitle: "Escolha uma ou mais. Você pode mudar isso quando quiser.",
  },
  {
    n: 4 as const,
    label: "Conectar",
    title: "Onde as pessoas vão falar com ele",
    subtitle: "Conecte agora ou deixe para depois — seu atendente já está pronto.",
  },
];

export const FIRST_STEP: StepNumber = 1;
export const LAST_STEP: StepNumber = 4;

export function isStepNumber(n: unknown): n is StepNumber {
  return n === 1 || n === 2 || n === 3 || n === 4;
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
  { value: "Agendar um horário", hint: "O agente puxa a conversa para marcar dia e hora." },
  { value: "Fechar uma venda", hint: "O agente apresenta o que você vende e encaminha a compra." },
  { value: "Entender o que a pessoa precisa", hint: "O agente qualifica e te entrega o contato pronto." },
  { value: "Tirar dúvidas sobre o serviço", hint: "O agente informa e deixa a pessoa segura para decidir." },
];

/* ---------------------------------------------------- processos / fluxos */

export type ProcessKey = "atendimento" | "vendas" | "suporte" | "agendamento";

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
    label: "Atender e tirar dúvidas",
    description: "Responde perguntas sobre preço, horário e como funciona — e guarda o contato.",
    actionKeys: ["register_lead"],
  },
  {
    key: "vendas",
    label: "Vender",
    description: "Apresenta o que você oferece e te avisa quando alguém está pronto para comprar.",
    actionKeys: ["register_lead", "mark_hot_lead"],
  },
  {
    key: "suporte",
    label: "Resolver problemas",
    description: "Ajuda quem já é cliente e chama uma pessoa do seu time quando não dá conta.",
    actionKeys: ["handoff_human"],
  },
  {
    key: "agendamento",
    label: "Agendar horários",
    description: "Marca dia e hora com a pessoa sem você precisar entrar na conversa.",
    actionKeys: ["schedule_meeting"],
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
  processes: ProcessKey[];
  customProcess: string;
};

export const EMPTY_DRAFT: OnboardingDraft = {
  agentName: "",
  tone: "",
  objective: "",
  processes: [],
  customProcess: "",
};

export const draftSchema = z.object({
  agentName: z.string().trim().max(40).default(""),
  tone: z.string().trim().max(120).default(""),
  objective: z.string().trim().max(160).default(""),
  processes: z.array(z.enum(PROCESS_KEYS)).default([]),
  customProcess: z.string().trim().max(240).default(""),
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
 * Passos 1 e 4 não travam: boas-vindas não pede nada e a integração pode
 * ficar para depois (o agente já funciona no sandbox sem ela).
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
      errors.objective = "Escolha o que ele deve buscar em cada conversa.";
    }
  }

  if (step === 3 && draft.processes.length === 0 && !draft.customProcess.trim()) {
    errors.processes = "Escolha pelo menos uma coisa para ele resolver.";
  }

  return errors;
}

export function isStepValid(step: StepNumber, draft: OnboardingDraft): boolean {
  return Object.keys(validateStep(step, draft)).length === 0;
}

/** O wizard só pode ser concluído se todos os passos que travam estiverem ok. */
export function canComplete(draft: OnboardingDraft): boolean {
  return isStepValid(2, draft) && isStepValid(3, draft);
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
    offer: describeProcesses(draft),
    avoid: "",
    objective: draft.objective.trim(),
  };
}
