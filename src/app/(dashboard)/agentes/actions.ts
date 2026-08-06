"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireTenant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { planOf } from "@/modules/billing/plans";
import { composeSystemPrompt, type PersonaAnswers } from "@/modules/agent-engine/persona";
import { ACTION_BY_KEY, type ActionKey } from "@/modules/agent-engine/actions";
import { createAgent, getAgentOwned, getAgentUsage } from "@/modules/agent-engine/agents";
import { saveScheduleConfig } from "@/modules/scheduling/repository";
import { saveFollowUpConfig } from "@/modules/follow-up/config";
import { ingestDocument, deleteDocument } from "@/modules/knowledge-base/repository";
import { extractTextFromFile } from "@/modules/knowledge-base/extract";
import { uploadToBunny } from "@/lib/bunny";

type Result = { ok: boolean; error?: string; info?: string };

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
  revalidatePath("/agentes");
  redirect(`/agentes/${agent.id}`);
}

export async function renameAgent(agentId: string, name: string): Promise<Result> {
  const { agent } = await requireAgent(agentId);
  if (!agent) return { ok: false, error: "Agente não encontrado" };

  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };

  await prisma.agent.update({ where: { id: agent.id }, data: { name: parsed.data } });
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

  await prisma.agent.update({
    where: { id: agent.id },
    data: {
      // O nome do agente na lista acompanha o que a pessoa respondeu no wizard.
      name: answers.agentName || agent.name,
      systemPrompt: composeSystemPrompt(answers),
      objective: answers.objective,
      personaDraft: answers,
    },
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

  await prisma.agent.update({
    where: { id: agent.id },
    data: { systemPrompt: composeSystemPrompt(answers), personaDraft: answers },
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

  await prisma.tenantAction.upsert({
    where: { agentId_key: { agentId: agent.id, key } },
    create: { tenantId, agentId: agent.id, key, enabled },
    update: { enabled },
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

  await deleteDocument(tenantId, documentId);
  revalidateAgent(agent.id);
  return { ok: true };
}
