import { prisma } from "@/lib/prisma";
import { getUsageSummary } from "@/modules/billing/usage";
import { embedQuery } from "@/modules/knowledge-base/embeddings";
import { searchSimilarChunks } from "@/modules/knowledge-base/repository";
import { getLLMProvider, isAiError, createProvider, type AiError, type LLMProvider, type LlmMessage, type LlmResult, type LlmToolSchema } from "@/modules/ai";
import { findModel, getGeminiFallbackChain } from "@/modules/ai/catalog";
import { recordUsage } from "@/modules/ai/usage";
import { parseScheduleConfig, scheduleSystemContext } from "@/modules/scheduling/config";
import { getToolSchemas, runToolHandler, type ToolContext } from "./tools";
import { appendMessage, getRecentMessages } from "./conversation";

const MAX_TOOL_ITERATIONS = 3;
const DEFAULT_SYSTEM =
  "Você é um atendente virtual comercial. Seja cordial e objetivo. Configure a persona em Configuração.";

/**
 * `ok` — o agente respondeu.
 * `agent_off` — existe agente, mas ele está desligado: a mensagem do contato
 *   fica registrada e NINGUÉM responde (é o ponto do botão de desligar).
 * `human_handling` — um humano respondeu manualmente pelo painel nesta
 *   conversa (`sendManualMessage`); a IA fica em silêncio só aqui até a
 *   conversa ser devolvida a ela. Diferente de `agent_off`: as outras
 *   conversas do mesmo agente continuam respondidas normalmente.
 * `no_agent` — a conta não tem agente ativo.
 * `limit_reached` — a conta esgotou a cota de conversas do mês (ver
 *   `modules/billing/usage.ts`): a mensagem fica registrada e a conversa sobe
 *   para "precisa de você", mas a IA fica em silêncio. O sandbox pula essa
 *   checagem (`skipUsageCheck`): testar não é atendimento.
 *
 * Quem chama decide o que fazer com o silêncio: o webhook do WhatsApp não
 * manda nada, o widget não mostra bolha, o sandbox explica o motivo na tela.
 */
export type TurnStatus = "ok" | "agent_off" | "human_handling" | "no_agent" | "limit_reached";

export type AgentTurn = { reply: string; toolsUsed: string[]; status: TurnStatus };

// Monta o contexto (persona + RAG + histórico), roda o loop de function calling
// e persiste as mensagens. Retorna a resposta final do agente.
export async function runAgentTurn(input: {
  tenantId: string;
  conversationId: string;
  leadId: string;
  userMessage: string;
  /** Agente que deve atender. Omitido (webhook do WhatsApp), usa o principal. */
  agentId?: string;
  /** Sandbox: pula a checagem de cota — testar não conta como atendimento. */
  skipUsageCheck?: boolean;
}): Promise<AgentTurn> {
  const { tenantId, conversationId, leadId, userMessage } = input;

  await appendMessage(conversationId, "user", userMessage);

  // Humano assumiu esta conversa (respondeu manualmente pelo painel): a
  // mensagem do contato fica registrada, mas a IA não responde por cima —
  // checa antes de resolver agente/persona porque nem chega a valer a pena
  // montar contexto para um turno que não vai gerar resposta.
  const paused = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { agentPaused: true },
  });
  if (paused?.agentPaused) {
    return { reply: "", toolsUsed: [], status: "human_handling" };
  }

  // Cota de conversas do mês esgotada (e não é o sandbox): a mensagem já ficou
  // registrada, a conversa é marcada para o dono responder, e a IA não fala
  // mais nada — o enforcement dos planos (ver billing/usage.ts).
  if (!input.skipUsageCheck) {
    const usage = await getUsageSummary(tenantId);
    if (usage.atLimit) {
      await prisma.conversation
        .update({ where: { id: conversationId }, data: { needsHuman: true } })
        .catch(() => {});
      return { reply: "", toolsUsed: [], status: "limit_reached" };
    }

    // Teto por conversa (limite × 3): a cota da conta é por conversa, então sem
    // isso uma única conversa usaria o LLM à vontade. Aqui o número já está
    // contando só as respostas da IA deste mês nesta conversa (a do turno
    // atual ainda não existe — é gravada no final). Estourar aqui silencia a
    // IA SÓ nesta conversa, o resto da conta continua atendendo.
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const aiRepliesThisConversation = await prisma.message.count({
      where: {
        conversationId,
        role: "assistant",
        sentBy: "agent",
        createdAt: { gte: monthStart },
      },
    });
    if (aiRepliesThisConversation >= usage.perConversationCap) {
      await prisma.conversation
        .update({ where: { id: conversationId }, data: { needsHuman: true } })
        .catch(() => {});
      return { reply: "", toolsUsed: [], status: "limit_reached" };
    }
  }

  const agent = await resolveAgent(tenantId, input.agentId);

  // Agente desligado: a mensagem do contato já ficou registrada, e a conversa
  // sobe para "precisa de você" — desligar o agente pausa a resposta
  // automática, não o atendimento. Sem essa marcação, mensagens recebidas com
  // o agente desligado sumiriam no meio da lista sem nenhum sinal.
  if (agent && !agent.enabled) {
    await prisma.conversation
      .update({ where: { id: conversationId }, data: { needsHuman: true } })
      .catch(() => {});
    return { reply: "", toolsUsed: [], status: "agent_off" };
  }

  const [actions, history] = await Promise.all([
    agent
      ? prisma.tenantAction.findMany({
          where: { agentId: agent.id, enabled: true },
          select: { key: true, config: true },
        })
      : Promise.resolve([]),
    getRecentMessages(conversationId, 10),
  ]);

  // Registra quem atendeu — /conversas mostra isso, e sem o vínculo não há
  // como saber depois qual agente respondeu o quê.
  if (agent) {
    await prisma.conversation
      .updateMany({ where: { id: conversationId, agentId: null }, data: { agentId: agent.id } })
      .catch(() => {});
  }

  const context = agent ? await retrieveContext(agent.id, userMessage) : "";

  // Expediente e data de hoje entram no prompt quando o agendamento está
  // ligado: sem isso o LLM não tem como saber que dia é hoje nem o horário de
  // atendimento, e propunha horários que a tool depois recusava.
  const scheduling = actions.find((a) => a.key === "schedule_meeting");
  const scheduleContext = scheduling
    ? scheduleSystemContext(parseScheduleConfig(scheduling.config))
    : "";

  const systemPrompt = [agent?.systemPrompt || DEFAULT_SYSTEM, scheduleContext, context]
    .filter(Boolean)
    .join("\n\n");

  const messages: LlmMessage[] = [
    { role: "system", content: systemPrompt },
    ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
  ];

  const toolSchemas = getToolSchemas(actions.map((a) => a.key));
  const ctx: ToolContext = { tenantId, conversationId, leadId, agentId: agent?.id ?? null };
  let llm = await getLLMProvider();
  // Chain de fallback resolvida UMA vez a partir do modelo ativo. Para um
  // Gemini do free tier: Grok → Groq (só os com chave configurada).
  const fallbackChain = getGeminiFallbackChain(llm.model);
  const toolsUsed: string[] = [];

  let finalReply = "";
  const attemptedModels = new Set<string>();
  try {
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      // Chama o LLM e, se falhar, caminha pela chain de fallback (ex.: Gemini
      // → Grok → Groq). `attemptedModels` evita repetir quem já deu erro.
      const { llm: nextLlm, result } = await completeWithFallback(
        llm,
        messages,
        toolSchemas,
        fallbackChain,
        attemptedModels,
      );
      llm = nextLlm;

      if (result.toolCalls.length === 0) {
        finalReply = result.content;
        break;
      }

      messages.push({ role: "assistant", content: result.content, toolCalls: result.toolCalls });
      for (const call of result.toolCalls) {
        toolsUsed.push(call.name);
        const out = await runToolHandler(call.name, ctx, call.arguments);
        messages.push({ role: "tool", toolCallId: call.id, content: out });
      }

      if (i === MAX_TOOL_ITERATIONS - 1) {
        // Última iteração: força uma resposta em texto sem mais tools. Fora
        // de `completeWithFallback` (não faz sentido trocar de provider só
        // pra fechar a resposta), então grava o uso aqui direto.
        const closing = await llm.complete(messages, []);
        recordUsage(llm.provider, closing.usage).catch(() => {});
        finalReply = closing.content;
      }
    }
  } catch (err) {
    if (!isAiError(err)) throw err;
    console.error(`[orchestrator] IA indisponível (${err.code}) em ${llm.provider}/${llm.model}`, err);

    // Cota do provedor esgotada (ex.: limite diário de tokens): o cliente não
    // recebe NENHUMA mensagem sobre o limite — só a conversa sobe como
    // "precisa de você" e um humano assume. Nada é registrado no histórico.
    if (err.code === "quota_exceeded") {
      await prisma.conversation
        .update({ where: { id: conversationId }, data: { needsHuman: true } })
        .catch(() => {});
      return { reply: "", toolsUsed, status: "limit_reached" };
    }

    // Erro de configuração (credencial) ou problema pontual: o lead recebe uma
    // resposta clara e a conversa é escalada em vez de morrer em silêncio.
    const escalate = err.code === "auth";
    if (escalate) {
      await prisma.conversation
        .update({ where: { id: conversationId }, data: { needsHuman: true } })
        .catch(() => {});
    }
    await appendMessage(conversationId, "assistant", err.userMessage, "agent");
    return { reply: err.userMessage, toolsUsed, status: "ok" };
  }

  if (!finalReply) finalReply = "Certo!";
  await appendMessage(conversationId, "assistant", finalReply, "agent");
  return { reply: finalReply, toolsUsed, status: agent ? "ok" : "no_agent" };
}

/**
 * Chama `complete` no provider atual; se falhar com `AiError`, tenta os
 * modelos da chain de fallback em ordem (ex.: Gemini → Grok → Groq). Devolve
 * o provider que respondeu junto do resultado, para o turno seguir com ele.
 * Se todos falharem, propaga o último erro.
 */
async function completeWithFallback(
  llm: LLMProvider,
  messages: LlmMessage[],
  toolSchemas: LlmToolSchema[],
  fallbackChain: string[],
  attemptedModels: Set<string>,
): Promise<{ llm: LLMProvider; result: LlmResult }> {
  try {
    const result = await llm.complete(messages, toolSchemas);
    recordUsage(llm.provider, result.usage).catch(() => {});
    return { llm, result };
  } catch (err) {
    if (!isAiError(err)) throw err;
    let lastErr: AiError = err;
    for (const fallbackId of fallbackChain) {
      if (attemptedModels.has(fallbackId)) continue;
      const model = findModel(fallbackId);
      if (!model) continue;
      attemptedModels.add(fallbackId);
      const next = createProvider(model);
      console.warn(
        `[orchestrator] Fallback: ${llm.provider} ${llm.model} indisponível (${lastErr.code}), usando ${model.provider} ${model.id}`,
      );
      try {
        // Registrado no provider que RESPONDEU (`next`), não no que falhou
        // (`llm`) — é exatamente o ponto que resolve a atribuição de uso que o
        // histórico anterior nunca teve: aqui sabemos com certeza quem gerou.
        const result = await next.complete(messages, toolSchemas);
        recordUsage(next.provider, result.usage).catch(() => {});
        return { llm: next, result };
      } catch (e) {
        if (!isAiError(e)) throw e;
        lastErr = e;
      }
    }
    throw lastErr;
  }
}

/**
 * Qual agente atende este turno. Com `agentId` explícito (sandbox de um agente
 * específico), usa aquele — validando que é da conta. Sem ele (webhook do
 * WhatsApp, que hoje tem um número por conta), cai no agente principal; se
 * nenhum estiver marcado, no mais antigo, para a conta nunca ficar muda.
 *
 * O agente DESLIGADO continua sendo resolvido aqui, em vez de filtrado por
 * `enabled: true`: filtrar faria o turno cair no próximo agente da conta e o
 * botão de desligar não desligaria nada. Quem trata o `enabled: false` é
 * `runAgentTurn`.
 *
 * Exportada porque o webhook do WhatsApp também precisa dela: para saber se a
 * opção "ouvir áudio" está ligada antes de gastar uma transcrição, e a de
 * "parar com emoji" antes de pausar a conversa.
 */
export async function resolveAgent(tenantId: string, agentId?: string) {
  const select = {
    id: true,
    systemPrompt: true,
    enabled: true,
    listenAudio: true,
    stopOnEmoji: true,
  } as const;
  if (agentId) {
    return prisma.agent.findFirst({
      where: { id: agentId, tenantId, archived: false },
      select,
    });
  }
  return prisma.agent.findFirst({
    where: { tenantId, archived: false },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    select,
  });
}

// Busca semântica na base de conhecimento (RAG). Silencioso se não configurado.
async function retrieveContext(agentId: string, query: string): Promise<string> {
  try {
    const embedding = await embedQuery(query);
    if (!embedding) return "";
    const chunks = await searchSimilarChunks(agentId, embedding, 4);
    if (chunks.length === 0) return "";
    return "Base de conhecimento (use para responder):\n" + chunks.map((c) => `- ${c.content}`).join("\n");
  } catch (err) {
    console.error("[orchestrator] RAG falhou", err);
    return "";
  }
}
