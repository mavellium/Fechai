import { prisma } from "@/lib/prisma";
import { embedQuery } from "@/modules/knowledge-base/embeddings";
import { searchSimilarChunks } from "@/modules/knowledge-base/repository";
import { getLLMProvider, isAiError, createProvider, type LlmMessage } from "@/modules/ai";
import { GEMINI_FALLBACK_CHAIN, findModel } from "@/modules/ai/catalog";
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
 * `no_agent` — a conta não tem agente ativo.
 *
 * Quem chama decide o que fazer com o silêncio: o webhook do WhatsApp não
 * manda nada, o widget não mostra bolha, o sandbox explica o motivo na tela.
 */
export type TurnStatus = "ok" | "agent_off" | "no_agent";

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
}): Promise<AgentTurn> {
  const { tenantId, conversationId, leadId, userMessage } = input;

  await appendMessage(conversationId, "user", userMessage);

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
  const toolsUsed: string[] = [];

  let finalReply = "";
  const attemptedModels = new Set<string>();
  try {
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      try {
        var result = await llm.complete(messages, toolSchemas);
      } catch (err) {
        // Fallback automático: se modelo Gemini falhar com erro de provider
        // (ex: modelo descontinuado), tenta próximo na chain
        if (isAiError(err) && err.code === "provider" && llm.provider === "gemini") {
          attemptedModels.add(llm.model);
          const nextModel = GEMINI_FALLBACK_CHAIN.find((m) => !attemptedModels.has(m));
          if (nextModel) {
            const model = findModel(nextModel);
            if (model) {
              console.warn(
                `[orchestrator] Fallback: modelo ${llm.model} indisponível, tentando ${nextModel}`,
              );
              llm = createProvider(model);
              var result = await llm.complete(messages, toolSchemas);
            } else {
              throw err;
            }
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      }

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
        // Última iteração: força uma resposta em texto sem mais tools.
        const closing = await llm.complete(messages, []);
        finalReply = closing.content;
      }
    }
  } catch (err) {
    if (!isAiError(err)) throw err;
    // Limite/credencial do provedor: o lead recebe uma resposta clara e a
    // conversa é escalada para humano em vez de morrer em silêncio.
    console.error(`[orchestrator] IA indisponível (${err.code}) em ${llm.provider}/${llm.model}`, err);
    const escalate = err.code === "quota_exceeded" || err.code === "auth";
    if (escalate) {
      await prisma.conversation
        .update({ where: { id: conversationId }, data: { needsHuman: true } })
        .catch(() => {});
    }
    await appendMessage(conversationId, "assistant", err.userMessage);
    return { reply: err.userMessage, toolsUsed, status: "ok" };
  }

  if (!finalReply) finalReply = "Certo!";
  await appendMessage(conversationId, "assistant", finalReply);
  return { reply: finalReply, toolsUsed, status: agent ? "ok" : "no_agent" };
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
 */
async function resolveAgent(tenantId: string, agentId?: string) {
  if (agentId) {
    return prisma.agent.findFirst({
      where: { id: agentId, tenantId, archived: false },
      select: { id: true, systemPrompt: true, enabled: true },
    });
  }
  return prisma.agent.findFirst({
    where: { tenantId, archived: false },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    select: { id: true, systemPrompt: true, enabled: true },
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
