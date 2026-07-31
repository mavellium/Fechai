import { prisma } from "@/lib/prisma";
import { embedQuery } from "@/modules/knowledge-base/embeddings";
import { searchSimilarChunks } from "@/modules/knowledge-base/repository";
import { getLLMProvider, isAiError, type LlmMessage } from "@/modules/ai";
import { getToolSchemas, runToolHandler, type ToolContext } from "./tools";
import { appendMessage, getRecentMessages } from "./conversation";

const MAX_TOOL_ITERATIONS = 3;
const DEFAULT_SYSTEM =
  "Você é um atendente virtual comercial. Seja cordial e objetivo. Configure a persona em Configuração.";

// Monta o contexto (persona + RAG + histórico), roda o loop de function calling
// e persiste as mensagens. Retorna a resposta final do agente.
export async function runAgentTurn(input: {
  tenantId: string;
  conversationId: string;
  leadId: string;
  userMessage: string;
  /** Agente que deve atender. Omitido (webhook do WhatsApp), usa o principal. */
  agentId?: string;
}): Promise<{ reply: string; toolsUsed: string[] }> {
  const { tenantId, conversationId, leadId, userMessage } = input;

  await appendMessage(conversationId, "user", userMessage);

  const agent = await resolveAgent(tenantId, input.agentId);

  const [actions, history] = await Promise.all([
    agent
      ? prisma.tenantAction.findMany({
          where: { agentId: agent.id, enabled: true },
          select: { key: true },
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
  const systemPrompt = [agent?.systemPrompt || DEFAULT_SYSTEM, context].filter(Boolean).join("\n\n");

  const messages: LlmMessage[] = [
    { role: "system", content: systemPrompt },
    ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
  ];

  const toolSchemas = getToolSchemas(actions.map((a) => a.key));
  const ctx: ToolContext = { tenantId, conversationId, leadId };
  const llm = await getLLMProvider();
  const toolsUsed: string[] = [];

  let finalReply = "";
  try {
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const result = await llm.complete(messages, toolSchemas);

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
    return { reply: err.userMessage, toolsUsed };
  }

  if (!finalReply) finalReply = "Certo!";
  await appendMessage(conversationId, "assistant", finalReply);
  return { reply: finalReply, toolsUsed };
}

/**
 * Qual agente atende este turno. Com `agentId` explícito (sandbox de um agente
 * específico), usa aquele — validando que é da conta. Sem ele (webhook do
 * WhatsApp, que hoje tem um número por conta), cai no agente principal; se
 * nenhum estiver marcado, no mais antigo, para a conta nunca ficar muda.
 */
async function resolveAgent(tenantId: string, agentId?: string) {
  if (agentId) {
    return prisma.agent.findFirst({
      where: { id: agentId, tenantId, archived: false },
      select: { id: true, systemPrompt: true },
    });
  }
  return prisma.agent.findFirst({
    where: { tenantId, archived: false },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    select: { id: true, systemPrompt: true },
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
