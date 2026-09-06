"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireTenant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { payloadTooLarge } from "@/lib/rate-limit";
import { planOf } from "@/modules/billing/plans";
import { composeSystemPrompt, type PersonaAnswers } from "@/modules/agent-engine/persona";
import { ACTION_BY_KEY, type ActionKey } from "@/modules/agent-engine/actions";
import { createAgent, getAgentOwned, getAgentUsage } from "@/modules/agent-engine/agents";
import { saveScheduleConfig } from "@/modules/scheduling/repository";
import { saveFollowUpConfig } from "@/modules/follow-up/config";
import {
  ingestDocument,
  deleteDocument,
  getDocument,
  updateDocument,
} from "@/modules/knowledge-base/repository";
import { extractTextFromFile } from "@/modules/knowledge-base/extract";
import { uploadToBunny } from "@/lib/bunny";
import {
  VOICE_SAMPLE_MAX_BYTES,
  VOICE_SAMPLE_MIN_BYTES,
  cloneVoice,
  deleteVoice,
  isFishAudioConfigured,
  synthesize,
} from "@/modules/voice/fish";
import { SAMPLE_TEXT, findCatalogVoice } from "@/modules/voice/catalog";
import { recordAudit, recordChange, recordDeletion } from "@/modules/audit/log";

export type Result = { ok: boolean; error?: string; info?: string };

/**
 * Todas as actions recebem `agentId` e passam por `requireAgent`: o id vem da
 * URL, então sem a checagem de dono trocar o id na barra de endereço daria
 * acesso ao agente de outra conta.
 */
async function requireAgent(agentId: string) {
  const { tenantId } = await requireTenant();
  const agent = await getAgentOwned(tenantId, agentId);
  if (!agent) return { tenantId, agent: null as null };
  return { tenantId, agent };
}

function revalidateAgent(agentId: string) {
  revalidatePath("/agentes");
  revalidatePath(`/agentes/${agentId}`);
  revalidatePath("/inicio");
}

// ---------------------------------------------------------------- agentes

const nameSchema = z.string().trim().min(1, "Dê um nome ao agente").max(60, "Nome muito longo");

/** Cria um agente e leva direto ao passo a passo dele. */
export async function createAgentAction(_prev: Result | null, formData: FormData): Promise<Result> {
  const tooLarge = payloadTooLarge(formData);
  if (tooLarge) return { ok: false, error: tooLarge };

  const { tenantId } = await requireTenant();
  const parsed = nameSchema.safeParse(formData.get("name"));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };

  // Limite revalidado no servidor: a UI já esconde o botão, mas ela não é a
  // única linha de defesa (mesma regra do teto de ações).
  const usage = await getAgentUsage(tenantId);
  if (!usage.canCreate) {
    return {
      ok: false,
      error: `Seu plano permite ${usage.limit} agente(s). Exclua um ou mude de plano.`,
    };
  }

  const agent = await createAgent(tenantId, parsed.data);

  await recordAudit({
    event: "agent.created",
    target: { type: "Agent", id: agent.id, label: agent.name },
    after: { name: agent.name },
  });

  revalidatePath("/agentes");
  redirect(`/agentes/${agent.id}`);
}

export async function renameAgent(agentId: string, name: string): Promise<Result> {
  const { agent } = await requireAgent(agentId);
  if (!agent) return { ok: false, error: "Agente não encontrado" };

  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };

  await prisma.agent.update({ where: { id: agent.id }, data: { name: parsed.data } });

  await recordChange({
    event: "agent.updated",
    target: { type: "Agent", id: agent.id, label: agent.name },
    before: { name: agent.name },
    after: { name: parsed.data },
  });

  revalidateAgent(agent.id);
  return { ok: true, info: "Nome atualizado." };
}

/**
 * Marca quem atende o número de WhatsApp da conta. Enquanto o número for um só
 * (ver CHANGELOG), promover um agente rebaixa o anterior — nunca dois
 * principais, nunca nenhum.
 */
export async function setPrimaryAgent(agentId: string): Promise<Result> {
  const { tenantId, agent } = await requireAgent(agentId);
  if (!agent) return { ok: false, error: "Agente não encontrado" };

  await prisma.$transaction([
    prisma.agent.updateMany({ where: { tenantId }, data: { isPrimary: false } }),
    prisma.agent.update({ where: { id: agent.id }, data: { isPrimary: true } }),
  ]);

  await recordChange({
    event: "agent.updated",
    target: { type: "Agent", id: agent.id, label: agent.name },
    before: { isPrimary: agent.isPrimary },
    after: { isPrimary: true },
  });

  revalidateAgent(agent.id);
  return { ok: true, info: `${agent.name} agora atende o WhatsApp.` };
}

/**
 * Liga/desliga o agente. Desligado ele para de responder em todos os canais
 * (WhatsApp, widget e chat de teste) sem perder nada do que foi configurado —
 * a alternativa que existia era excluir o agente ou desconectar o WhatsApp da
 * conta inteira.
 */
export async function setAgentEnabled(agentId: string, enabled: boolean): Promise<Result> {
  const { agent } = await requireAgent(agentId);
  if (!agent) return { ok: false, error: "Agente não encontrado" };

  await prisma.agent.update({ where: { id: agent.id }, data: { enabled } });

  await recordChange({
    event: "agent.updated",
    target: { type: "Agent", id: agent.id, label: agent.name },
    before: { enabled: agent.enabled },
    after: { enabled },
  });

  revalidateAgent(agent.id);
  revalidatePath("/conversas");
  return {
    ok: true,
    info: enabled
      ? `${agent.name} voltou a responder.`
      : `${agent.name} está desligado e não responde mais até você ligar de novo.`,
  };
}

/**
 * Liga/desliga um comportamento de conversa do agente (passo Comportamento):
 * `listenAudio` (ouvir mensagens de voz), `stopOnEmoji` (encerrar quando o
 * cliente manda só um emoji) e `speakReplies` (responder em áudio). São colunas
 * do Agent, não ações com limite de plano — por isso não passam por
 * `setActionEnabled`.
 */
const BEHAVIOR_FIELDS = ["listenAudio", "stopOnEmoji", "speakReplies"] as const;
type BehaviorField = (typeof BEHAVIOR_FIELDS)[number];

export async function setAgentBehavior(
  agentId: string,
  field: BehaviorField,
  enabled: boolean,
): Promise<Result> {
  const { agent } = await requireAgent(agentId);
  if (!agent) return { ok: false, error: "Agente não encontrado" };

  if (!BEHAVIOR_FIELDS.includes(field)) {
    return { ok: false, error: "Comportamento inválido" };
  }

  // Ligar "responder com áudio" sem voz gravada não quebra nada (a resposta sai
  // em texto), mas o toggle ligado prometeria algo que não acontece. Recusar
  // aqui é o que faz a tela contar a verdade.
  if (field === "speakReplies" && enabled) {
    if (!isFishAudioConfigured()) {
      return { ok: false, error: "A resposta em áudio não está disponível nesta instalação." };
    }
    const voice = await prisma.agent.findUnique({
      where: { id: agent.id },
      select: { voiceId: true },
    });
    if (!voice?.voiceId) {
      return { ok: false, error: "Grave a voz do agente antes de ligar a resposta em áudio." };
    }
  }

  await prisma.agent.update({ where: { id: agent.id }, data: { [field]: enabled } });

  await recordChange({
    event: "agent.behavior_updated",
    target: { type: "Agent", id: agent.id, label: agent.name },
    before: { [field]: agent[field] },
    after: { [field]: enabled },
  });

  revalidateAgent(agent.id);
  return { ok: true, info: "Comportamento atualizado." };
}

// ------------------------------------------------------------------ voz

/**
 * Formatos que os navegadores produzem ao gravar (`MediaRecorder` entrega webm
 * no Chrome/Firefox e mp4 no Safari) mais os que a pessoa pode enviar de um
 * arquivo. A lista existe para não mandar um PDF renomeado para a Fish Audio.
 */
const VOICE_MIMES = [
  "audio/webm",
  "audio/ogg",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/wav",
  "audio/x-wav",
];

/**
 * Clona a voz do dono da conta na Fish Audio e guarda o id no agente.
 *
 * A amostra NÃO é armazenada por nós: ela vai para a Fish Audio, vira um modelo
 * e o buffer morre com a request. Guardar a gravação significaria assumir a
 * custódia da voz de uma pessoa (dado biométrico) para nunca mais usá-la — o
 * modelo é a única coisa que o produto precisa de volta.
 *
 * Regravar SUBSTITUI: o modelo anterior é apagado lá antes de gravarmos o novo
 * id, senão cada regravação deixaria um modelo órfão na conta da plataforma,
 * cobrando e guardando a voz de um cliente para sempre.
 */
export async function saveAgentVoice(
  _prev: Result | null,
  formData: FormData,
): Promise<Result> {
  const tooLarge = payloadTooLarge(formData);
  if (tooLarge) return { ok: false, error: tooLarge };

  const agentId = String(formData.get("agentId") ?? "");
  const { agent } = await requireAgent(agentId);
  if (!agent) return { ok: false, error: "Agente não encontrado" };

  if (!isFishAudioConfigured()) {
    return { ok: false, error: "A resposta em áudio não está disponível nesta instalação." };
  }

  const file = formData.get("sample");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Grave ou envie uma amostra da sua voz." };
  }
  if (file.size > VOICE_SAMPLE_MAX_BYTES) {
    return { ok: false, error: "A gravação é grande demais. Grave algo em torno de 30 segundos." };
  }
  if (file.size < VOICE_SAMPLE_MIN_BYTES) {
    return { ok: false, error: "A gravação ficou curta demais. Fale por uns 20 a 30 segundos." };
  }

  const mime = (file.type || "audio/webm").split(";")[0].trim();
  if (!VOICE_MIMES.includes(mime)) {
    return { ok: false, error: "Formato de áudio não suportado. Grave pelo painel ou envie um MP3." };
  }

  const label = String(formData.get("label") ?? "").trim().slice(0, 60) || "Minha voz";

  const cloned = await cloneVoice({
    audio: Buffer.from(await file.arrayBuffer()),
    mime,
    // Identifica o dono do modelo dentro da conta da plataforma na Fish Audio,
    // onde convivem as vozes de todos os tenants.
    title: `fechai · ${agent.id} · ${label}`,
  });
  if (!cloned.ok) return { ok: false, error: cloned.error };

  const previous = await prisma.agent.findUnique({
    where: { id: agent.id },
    select: { voiceId: true, voiceSource: true },
  });

  await prisma.agent.update({
    where: { id: agent.id },
    data: {
      voiceId: cloned.referenceId,
      voiceLabel: label,
      voiceSource: "recorded",
      voiceCreatedAt: new Date(),
    },
  });

  // Só depois de a nova voz estar salva: se apagássemos antes e o update
  // falhasse, a conta ficaria sem voz nenhuma. E só se a anterior era nossa —
  // voz do catálogo é compartilhada (ver deleteAgentVoice).
  if (previous?.voiceId && previous.voiceSource !== "catalog") {
    await deleteVoice(previous.voiceId);
  }

  revalidateAgent(agent.id);
  return { ok: true, info: "Voz gravada. Ligue “Responder com áudio” para o agente usá-la." };
}

/**
 * Gera a amostra de uma voz pronta para a pessoa ouvir ANTES de escolher.
 *
 * Devolve data URL em vez de guardar arquivo: a amostra é descartável, vive só
 * enquanto a tela está aberta, e subir isso para a CDN encheria o storage de
 * áudio que ninguém vai reouvir.
 *
 * Custa uma síntese (~R$0,007) por clique no play — por isso a tela pede o
 * áudio só quando a pessoa clica, e não ao abrir a lista.
 */
export async function previewCatalogVoice(
  voiceKey: string,
): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string }> {
  // Só exige sessão de tenant: a amostra não toca em nenhum agente.
  await requireTenant();

  if (!isFishAudioConfigured()) {
    return { ok: false, error: "A resposta em áudio não está disponível nesta instalação." };
  }

  const voice = findCatalogVoice(voiceKey);
  if (!voice) return { ok: false, error: "Voz não encontrada." };

  const audio = await synthesize({ text: SAMPLE_TEXT, referenceId: voice.referenceId });
  if (!audio) return { ok: false, error: "Não foi possível gerar a amostra agora." };

  return {
    ok: true,
    dataUrl: `data:${audio.mime};base64,${audio.audio.toString("base64")}`,
  };
}

/**
 * Escolhe uma das vozes prontas (ver `modules/voice/catalog.ts`).
 *
 * Substitui a voz atual, qualquer que fosse. Se a anterior era GRAVADA, o
 * modelo dela é apagado na Fish Audio: trocar por uma voz pronta é abandonar a
 * gravação, e deixá-la lá guardaria a voz de um cliente sem ninguém usando.
 */
export async function setAgentCatalogVoice(agentId: string, voiceKey: string): Promise<Result> {
  const { agent } = await requireAgent(agentId);
  if (!agent) return { ok: false, error: "Agente não encontrado" };

  if (!isFishAudioConfigured()) {
    return { ok: false, error: "A resposta em áudio não está disponível nesta instalação." };
  }

  // A tela manda a CHAVE, não o `reference_id`: assim um id arbitrário nunca
  // entra no banco pela action, só os que nós curamos.
  const voice = findCatalogVoice(voiceKey);
  if (!voice) return { ok: false, error: "Voz não encontrada." };

  const previous = await prisma.agent.findUnique({
    where: { id: agent.id },
    select: { voiceId: true, voiceSource: true },
  });

  await prisma.agent.update({
    where: { id: agent.id },
    data: {
      voiceId: voice.referenceId,
      voiceLabel: voice.name,
      voiceSource: "catalog",
      voiceCreatedAt: new Date(),
    },
  });

  // Só a voz GRAVADA é nossa para apagar (ver `voiceSource` no schema).
  if (previous?.voiceSource === "recorded" && previous.voiceId) {
    await deleteVoice(previous.voiceId);
  }

  revalidateAgent(agent.id);
  return { ok: true, info: `Voz ${voice.name} selecionada.` };
}

/**
 * Apaga a voz do agente. Desliga a resposta em áudio junto: sem voz ela não
 * aconteceria de todo jeito, e um toggle ligado que não faz nada é pior que um
 * desligado.
 *
 * O modelo na Fish Audio só é apagado quando a voz era GRAVADA. Voz do catálogo
 * é compartilhada entre todas as contas — apagá-la derrubaria a voz de quem
 * mais tivesse escolhido a mesma.
 */
export async function deleteAgentVoice(agentId: string): Promise<Result> {
  const { agent } = await requireAgent(agentId);
  if (!agent) return { ok: false, error: "Agente não encontrado" };

  const current = await prisma.agent.findUnique({
    where: { id: agent.id },
    select: { voiceId: true, voiceSource: true },
  });

  await prisma.agent.update({
    where: { id: agent.id },
    data: {
      voiceId: null,
      voiceLabel: null,
      voiceSource: null,
      voiceCreatedAt: null,
      speakReplies: false,
    },
  });
  // `voiceSource` null = conta anterior a este campo, quando só existia voz
  // gravada — apagar continua certo nesse caso.
  if (current?.voiceId && current.voiceSource !== "catalog") {
    await deleteVoice(current.voiceId);
  }

  revalidateAgent(agent.id);
  return { ok: true, info: "Voz removida. O agente volta a responder só em texto." };
}

/**
 * Exclui o agente (e, por cascade, sua base e ações). As conversas ficam: o
 * vínculo é `SetNull`, então o histórico e os leads sobrevivem ao agente.
 */
export async function deleteAgent(agentId: string): Promise<Result> {
  const { tenantId, agent } = await requireAgent(agentId);
  if (!agent) return { ok: false, error: "Agente não encontrado" };

  const total = await prisma.agent.count({ where: { tenantId, archived: false } });
  if (total <= 1) {
    return { ok: false, error: "Sua conta precisa de pelo menos um agente." };
  }

  // Snapshot ANTES do delete: depois não há mais o que ler, e é este JSON que
  // o admin usa para restaurar o agente com o mesmo id em /admin/logs. O que
  // não volta junto são os filhos apagados em cascade (documentos, ações) —
  // a tela do log avisa isso antes de confirmar.
  await recordDeletion({
    event: "agent.deleted",
    target: { type: "Agent", id: agent.id, label: agent.name },
    snapshot: {
      id: agent.id,
      tenantId,
      name: agent.name,
      systemPrompt: agent.systemPrompt,
      objective: agent.objective,
      personaDraft: agent.personaDraft,
      enabled: agent.enabled,
      listenAudio: agent.listenAudio,
      stopOnEmoji: agent.stopOnEmoji,
      speakReplies: agent.speakReplies,
      isPrimary: agent.isPrimary,
      archived: agent.archived,
    },
  });

  await prisma.agent.delete({ where: { id: agent.id } });

  // Se o excluído era o principal, promove outro — a conta não pode ficar sem
  // ninguém atendendo o WhatsApp.
  if (agent.isPrimary) {
    const next = await prisma.agent.findFirst({
      where: { tenantId, archived: false },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (next) await prisma.agent.update({ where: { id: next.id }, data: { isPrimary: true } });
  }

  revalidatePath("/agentes");
  revalidatePath("/inicio");
  return { ok: true, info: "Agente excluído." };
}

// ---------------------------------------------------------------- persona

const personaSchema = z.object({
  agentName: z.string().trim().default(""),
  businessName: z.string().trim().min(1, "Informe o nome do negócio"),
  sector: z.string().trim().default(""),
  tone: z.string().trim().default(""),
  offer: z.string().trim().default(""),
  avoid: z.string().trim().default(""),
  objective: z.string().trim().default(""),
});

export async function savePersona(_prev: Result | null, formData: FormData): Promise<Result> {
  const tooLarge = payloadTooLarge(formData);
  if (tooLarge) return { ok: false, error: tooLarge };

  const agentId = String(formData.get("agentId") ?? "");
  const { agent } = await requireAgent(agentId);
  if (!agent) return { ok: false, error: "Agente não encontrado" };

  const parsed = personaSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  // `avoid` não faz mais parte deste formulário (virou o passo Regras, com
  // sua própria action) — preserva o que já estava salvo em vez de confiar no
  // `.default("")` do schema, que apagaria as regras a cada save de persona.
  const existingAvoid = (agent.personaDraft as Partial<PersonaAnswers> | null)?.avoid ?? "";
  const answers: PersonaAnswers = { ...parsed.data, avoid: existingAvoid };

  const next = {
    // O nome do agente na lista acompanha o que a pessoa respondeu no wizard.
    name: answers.agentName || agent.name,
    systemPrompt: composeSystemPrompt(answers),
    objective: answers.objective,
    personaDraft: answers,
  };

  await prisma.agent.update({ where: { id: agent.id }, data: next });

  await recordChange({
    event: "agent.persona_updated",
    target: { type: "Agent", id: agent.id, label: agent.name },
    before: {
      name: agent.name,
      systemPrompt: agent.systemPrompt,
      objective: agent.objective,
      personaDraft: agent.personaDraft,
    },
    after: next,
  });

  revalidateAgent(agent.id);
  return { ok: true, info: "Persona salva." };
}

const rulesSchema = z.object({
  rules: z.string().trim().default(""),
});

/**
 * Regras (`avoid`) têm a própria action porque o formulário de Regras não
 * carrega os outros campos de persona no DOM — reaproveitar `personaSchema`
 * faria o resto da persona cair no `.default("")` e ser apagado.
 */
export async function saveRules(_prev: Result | null, formData: FormData): Promise<Result> {
  const tooLarge = payloadTooLarge(formData);
  if (tooLarge) return { ok: false, error: tooLarge };

  const agentId = String(formData.get("agentId") ?? "");
  const { agent } = await requireAgent(agentId);
  if (!agent) return { ok: false, error: "Agente não encontrado" };

  const parsed = rulesSchema.safeParse({ rules: formData.get("rules") });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const draft = (agent.personaDraft as Partial<PersonaAnswers> | null) ?? {};
  const answers: PersonaAnswers = {
    agentName: draft.agentName ?? "",
    businessName: draft.businessName ?? "",
    sector: draft.sector ?? "",
    tone: draft.tone ?? "",
    offer: draft.offer ?? "",
    objective: draft.objective ?? "",
    avoid: parsed.data.rules,
  };

  const next = { systemPrompt: composeSystemPrompt(answers), personaDraft: answers };
  await prisma.agent.update({ where: { id: agent.id }, data: next });

  await recordChange({
    event: "agent.rules_updated",
    target: { type: "Agent", id: agent.id, label: agent.name },
    before: { systemPrompt: agent.systemPrompt, personaDraft: agent.personaDraft },
    after: next,
  });

  revalidateAgent(agent.id);
  return { ok: true, info: "Regras salvas." };
}

// ----------------------------------------------------------------- ações

export async function setActionEnabled(
  agentId: string,
  key: ActionKey,
  enabled: boolean,
): Promise<Result> {
  const { tenantId, agent } = await requireAgent(agentId);
  if (!agent) return { ok: false, error: "Agente não encontrado" };
  const def = ACTION_BY_KEY[key];
  if (!def) return { ok: false, error: "Ação inválida" };
  if (def.status === "disabled") {
    return { ok: false, error: "Esta ação está desativada por enquanto." };
  }

  if (enabled) {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    const limit = planOf(tenant?.planKey).maxActiveActions;
    // Teto por agente: cada agente tem seu próprio orçamento de ações.
    const active = await prisma.tenantAction.count({ where: { agentId: agent.id, enabled: true } });
    if (active >= limit) {
      return { ok: false, error: `Seu plano permite ${limit} ações por agente. Desative uma antes.` };
    }
  }

  const previous = await prisma.tenantAction.findUnique({
    where: { agentId_key: { agentId: agent.id, key } },
    select: { id: true, enabled: true },
  });

  const saved = await prisma.tenantAction.upsert({
    where: { agentId_key: { agentId: agent.id, key } },
    create: { tenantId, agentId: agent.id, key, enabled },
    update: { enabled },
  });

  await recordChange({
    event: "agent.action_toggled",
    // O alvo é a linha de TenantAction, não o agente: é ela que um undo
    // regrava. `targetLabel` fica com o nome legível da ação para o log não
    // virar "TenantAction ckx…" na tela.
    target: { type: "TenantAction", id: saved.id, label: `${def.label} · ${agent.name}` },
    before: { enabled: previous?.enabled ?? false },
    after: { enabled },
    meta: { acao: key, agente: agent.name },
  });

  revalidateAgent(agent.id);
  return { ok: true };
}

// ------------------------------------------------- configuração da agenda

const scheduleConfigSchema = z.object({
  durationMinutes: z.coerce.number().int().min(5).max(480),
  timezone: z.string().trim().min(1),
  startTime: z.string().regex(/^\d{1,2}:\d{2}$/, "Horário inválido"),
  endTime: z.string().regex(/^\d{1,2}:\d{2}$/, "Horário inválido"),
  location: z.string().trim().max(200).default(""),
  minNoticeHours: z.coerce.number().int().min(0).max(168),
});

/**
 * Horário de atendimento usado pela ação "Agendar horário". Fica em
 * `TenantAction.config` (ver módulo scheduling) — é configuração da ação, não
 * do agente.
 */
export async function saveScheduleConfigAction(
  _prev: Result | null,
  formData: FormData,
): Promise<Result> {
  const tooLarge = payloadTooLarge(formData);
  if (tooLarge) return { ok: false, error: tooLarge };

  const agentId = String(formData.get("agentId") ?? "");
  const { tenantId, agent } = await requireAgent(agentId);
  if (!agent) return { ok: false, error: "Agente não encontrado" };

  const parsed = scheduleConfigSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  // Checkboxes: `getAll` porque um <input name="workdays"> por dia marcado.
  const workdays = formData
    .getAll("workdays")
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  if (workdays.length === 0) {
    return { ok: false, error: "Escolha pelo menos um dia de atendimento." };
  }

  const [startH, startM] = parsed.data.startTime.split(":").map(Number);
  const [endH, endM] = parsed.data.endTime.split(":").map(Number);
  if (startH * 60 + startM >= endH * 60 + endM) {
    return { ok: false, error: "O fim do expediente precisa ser depois do início." };
  }

  await saveScheduleConfig(tenantId, agent.id, { ...parsed.data, workdays });
  revalidateAgent(agent.id);
  revalidatePath("/agenda");
  return { ok: true, info: "Horário de atendimento salvo." };
}

// --------------------------------------------------- configuração do follow-up

const followUpConfigSchema = z.object({
  delayHours: z.coerce.number().int().min(1).max(720),
  message: z.string().trim().min(1, "Escreva a mensagem de follow-up").max(500),
});

/**
 * Intervalo de silêncio usado pela ação "Follow-up automático". Fica em
 * `TenantAction.config` (ver módulo follow-up), igual ao horário de
 * atendimento do agendamento.
 */
export async function saveFollowUpConfigAction(
  _prev: Result | null,
  formData: FormData,
): Promise<Result> {
  const tooLarge = payloadTooLarge(formData);
  if (tooLarge) return { ok: false, error: tooLarge };

  const agentId = String(formData.get("agentId") ?? "");
  const { tenantId, agent } = await requireAgent(agentId);
  if (!agent) return { ok: false, error: "Agente não encontrado" };

  const parsed = followUpConfigSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  await saveFollowUpConfig(tenantId, agent.id, parsed.data);
  revalidateAgent(agent.id);
  return { ok: true, info: "Follow-up salvo." };
}

// ----------------------------------------------------------- conhecimento

// Mantenha em sincronia com serverActions.bodySizeLimit em next.config.ts —
// aquele é o teto duro do Next.js (a requisição nem chega aqui se estourar);
// este é o que dá pro usuário uma mensagem legível em vez de um crash 413.
const MAX_KB_FILE_BYTES = 50 * 1024 * 1024;

export async function addDocument(_prev: Result | null, formData: FormData): Promise<Result> {
  const agentId = String(formData.get("agentId") ?? "");
  const { tenantId, agent } = await requireAgent(agentId);
  if (!agent) return { ok: false, error: "Agente não encontrado" };

  const title = String(formData.get("title") ?? "").trim();
  const pasted = String(formData.get("content") ?? "").trim();
  const file = formData.get("file");

  if (!title) return { ok: false, error: "Dê um título ao documento" };

  if (file instanceof File && file.size > MAX_KB_FILE_BYTES) {
    return { ok: false, error: "Arquivo muito grande. O tamanho máximo é 50MB." };
  }

  let content = pasted;
  let fileUrl: string | undefined;
  let fileName: string | undefined;
  try {
    if (file instanceof File && file.size > 0) {
      content = await extractTextFromFile(file);

      // Guarda o arquivo original na CDN — antes ele era descartado depois de
      // extrair o texto, e o cliente não tinha como baixar de volta o que enviou.
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `knowledge/${tenantId}/${agent.id}/${Date.now()}-${safeName}`;
      const uploaded = await uploadToBunny(
        path,
        Buffer.from(await file.arrayBuffer()),
        file.type || "application/octet-stream",
      );
      if (uploaded.ok) {
        fileUrl = uploaded.url;
        fileName = file.name;
      } else {
        console.error("[knowledge-base] falha ao guardar arquivo original na CDN", uploaded.error);
      }
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Falha ao ler arquivo" };
  }

  if (!content) return { ok: false, error: "Cole um texto ou envie um arquivo" };

  const doc = await ingestDocument({ tenantId, agentId: agent.id, title, content, fileUrl, fileName });

  await recordAudit({
    event: "knowledge.added",
    target: { type: "KnowledgeDocument", id: doc.id, label: title },
    // Sem o `content`: um documento pode ter dezenas de milhares de
    // caracteres, e o log guarda o que aconteceu, não uma segunda cópia da
    // base de conhecimento. Tamanho é o bastante para auditar.
    after: { title, status: doc.status, fileName, caracteres: content.length },
    meta: { agente: agent.name },
  });

  revalidateAgent(agent.id);
  const info =
    doc.status === "no_embeddings"
      ? "Documento salvo (embeddings desativados: configure GEMINI_API_KEY)."
      : doc.status === "failed"
        ? "Documento salvo, mas houve falha ao gerar embeddings."
        : "Documento adicionado à base.";
  return { ok: true, info };
}

export async function removeDocument(agentId: string, documentId: string): Promise<Result> {
  const { tenantId, agent } = await requireAgent(agentId);
  if (!agent) return { ok: false, error: "Agente não encontrado" };

  // Lido antes de apagar: é este snapshot que permite restaurar o documento
  // com o mesmo id em /admin/logs. O `content` entra inteiro (é o que faz a
  // restauração valer a pena) e o redator corta se passar do teto — nesse
  // caso o revert recusa em vez de recriar um documento truncado.
  const doc = await getDocument(tenantId, agent.id, documentId);

  await deleteDocument(tenantId, documentId);

  if (doc) {
    await recordDeletion({
      event: "knowledge.deleted",
      target: { type: "KnowledgeDocument", id: documentId, label: doc.title },
      snapshot: {
        id: documentId,
        tenantId,
        agentId: agent.id,
        title: doc.title,
        content: doc.content,
        status: doc.status,
        // A URL volta, mas o arquivo em si já saiu da CDN — restaurar o
        // documento devolve o texto extraído, não o anexo original.
        fileUrl: doc.fileUrl,
        fileName: doc.fileName,
      },
      meta: { agente: agent.name, arquivoNaCdn: Boolean(doc.fileUrl) },
    });
  }

  revalidateAgent(agent.id);
  return { ok: true };
}

type DocumentContentResult =
  | { ok: true; title: string; content: string }
  | { ok: false; error: string };

// Busca o texto sob demanda (ao abrir o modal de ver/editar) em vez de mandar
// o conteúdo de todo documento na lista — evita puxar texto grande sem precisar.
export async function getDocumentContent(
  agentId: string,
  documentId: string,
): Promise<DocumentContentResult> {
  const { tenantId, agent } = await requireAgent(agentId);
  if (!agent) return { ok: false, error: "Agente não encontrado" };

  const doc = await getDocument(tenantId, agent.id, documentId);
  if (!doc) return { ok: false, error: "Documento não encontrado" };
  return { ok: true, title: doc.title, content: doc.content };
}

export async function updateDocumentAction(_prev: Result | null, formData: FormData): Promise<Result> {
  const tooLarge = payloadTooLarge(formData);
  if (tooLarge) return { ok: false, error: tooLarge };

  const agentId = String(formData.get("agentId") ?? "");
  const documentId = String(formData.get("documentId") ?? "");
  const { tenantId, agent } = await requireAgent(agentId);
  if (!agent) return { ok: false, error: "Agente não encontrado" };

  const title = String(formData.get("title") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();
  if (!title) return { ok: false, error: "Dê um título ao documento" };
  if (!content) return { ok: false, error: "O texto não pode ficar vazio" };

  const previous = await getDocument(tenantId, agent.id, documentId);

  const doc = await updateDocument(tenantId, agent.id, documentId, { title, content });
  if (!doc) return { ok: false, error: "Documento não encontrado" };

  await recordChange({
    event: "knowledge.updated",
    target: { type: "KnowledgeDocument", id: documentId, label: title },
    before: { title: previous?.title, content: previous?.content },
    after: { title, content },
    meta: { agente: agent.name },
  });

  revalidateAgent(agent.id);
  const info =
    doc.status === "no_embeddings"
      ? "Documento atualizado (embeddings desativados: configure GEMINI_API_KEY)."
      : doc.status === "failed"
        ? "Documento atualizado, mas houve falha ao gerar embeddings."
        : "Documento atualizado.";
  return { ok: true, info };
}
