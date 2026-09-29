import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { embedQuery } from "@/modules/knowledge-base/embeddings";
import { parseGapSettings, DEFAULT_GAP_SETTINGS, type GapMode, type GapSettings } from "./settings";
import { cleanQuestion, GROUP_MAX_DISTANCE, normalizeQuestion } from "./text";

/** Regra e avisos da conta; sem linha salva, os padrões. Nunca lança. */
export async function getGapSettings(tenantId: string): Promise<GapSettings> {
  try {
    return parseGapSettings(await prisma.knowledgeGapSettings.findUnique({ where: { tenantId } }));
  } catch (err) {
    console.error("[knowledge-gaps] regra da conta indisponível", err);
    return DEFAULT_GAP_SETTINGS;
  }
}

/**
 * `created` — assunto novo na fila. `grouped` — outra conversa perguntando algo
 * que já estava na fila. `repeated` — a mesma conversa perguntando de novo
 * (não conta como mais uma pessoa). `test` — sandbox, fora da fila. `failed` —
 * nada gravado.
 */
export type RegisterGapResult = {
  status: "created" | "grouped" | "repeated" | "test" | "failed";
  gapId?: string;
  mode: GapMode;
};

function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

/**
 * Põe a pergunta que o agente não soube responder na fila da equipe.
 * Chamada pelas tools `report_unanswered` e `handoff_human` (com
 * `unanswered`), no meio do turno.
 *
 * **Nunca lança**: é o registro de uma falta, e falhar aqui não pode virar uma
 * segunda falta (o contato sem resposta nenhuma). O `mode` volta mesmo na
 * falha, para a tool aplicar a regra de transbordo da conta.
 *
 * Conversa de teste fica de fora, como em todo relatório e aviso: o telefone
 * do sandbox não é gente, e a fila mediria a curiosidade do dono.
 */
export async function registerKnowledgeGap(input: {
  tenantId: string;
  conversationId: string;
  agentId: string | null;
  question?: unknown;
}): Promise<RegisterGapResult> {
  const settings = await getGapSettings(input.tenantId);
  const mode = settings.onUnanswered;
  try {
    const conversation = await prisma.conversation.findFirst({
      where: { id: input.conversationId, tenantId: input.tenantId },
      select: {
        isTest: true,
        lead: { select: { isTest: true } },
        messages: {
          where: { role: "user" },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1,
          select: { id: true, content: true },
        },
      },
    });
    if (!conversation) return { status: "failed", mode };
    if (conversation.isTest || conversation.lead.isTest) return { status: "test", mode };

    const lastUser = conversation.messages[0];
    // O agente reescreve a pergunta curta e sem dado pessoal; se não mandou,
    // a própria fala do contato é melhor que um item vazio na fila.
    const question = cleanQuestion(input.question) || cleanQuestion(lastUser?.content);
    if (!question) return { status: "failed", mode };

    const normalized = normalizeQuestion(question);
    const embedding = await embedQuery(question).catch((err) => {
      console.error("[knowledge-gaps] embedding da pergunta falhou", err);
      return null;
    });

    const match = await findOpenMatch(input.tenantId, input.agentId, normalized, embedding);
    const now = new Date();

    if (match) {
      const existing = await prisma.knowledgeGapOccurrence.findUnique({
        where: { gapId_conversationId: { gapId: match, conversationId: input.conversationId } },
        select: { id: true },
      });
      if (existing) {
        await prisma.knowledgeGapOccurrence.update({
          where: { id: existing.id },
          data: { askedAt: now, messageId: lastUser?.id ?? null, question },
        });
        await prisma.knowledgeGap.update({ where: { id: match }, data: { lastAskedAt: now } });
        return { status: "repeated", gapId: match, mode };
      }
      try {
        await prisma.$transaction([
          prisma.knowledgeGapOccurrence.create({
            data: {
              tenantId: input.tenantId,
              gapId: match,
              conversationId: input.conversationId,
              messageId: lastUser?.id ?? null,
              question,
              askedAt: now,
            },
          }),
          prisma.knowledgeGap.update({
            where: { id: match },
            data: { askedCount: { increment: 1 }, lastAskedAt: now },
          }),
        ]);
      } catch (err) {
        // Dois turnos da mesma conversa ao mesmo tempo: o outro já contou.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          return { status: "repeated", gapId: match, mode };
        }
        throw err;
      }
      return { status: "grouped", gapId: match, mode };
    }

    const gap = await prisma.knowledgeGap.create({
      data: {
        tenantId: input.tenantId,
        agentId: input.agentId,
        question,
        normalized,
        firstAskedAt: now,
        lastAskedAt: now,
        occurrences: {
          create: {
            tenantId: input.tenantId,
            conversationId: input.conversationId,
            messageId: lastUser?.id ?? null,
            question,
            askedAt: now,
          },
        },
      },
      select: { id: true },
    });
    if (embedding) {
      await prisma.$executeRaw`
        UPDATE "KnowledgeGap" SET embedding = ${toVectorLiteral(embedding)}::vector
        WHERE id = ${gap.id} AND "tenantId" = ${input.tenantId}`;
    }
    return { status: "created", gapId: gap.id, mode };
  } catch (err) {
    console.error("[knowledge-gaps] pergunta sem resposta não registrada", err);
    return { status: "failed", mode };
  }
}

/**
 * Assunto ABERTO do mesmo agente que é a mesma pergunta: primeiro pelo texto
 * normalizado (barato e exato), depois pelo vetor. Respondidos e descartados
 * não recebem pergunta nova — se o agente ainda não soube responder algo já
 * respondido, a base não cobriu, e isso precisa aparecer como item novo.
 */
async function findOpenMatch(
  tenantId: string,
  agentId: string | null,
  normalized: string,
  embedding: number[] | null,
): Promise<string | null> {
  const exact = await prisma.knowledgeGap.findFirst({
    where: { tenantId, agentId, status: "open", normalized },
    orderBy: { lastAskedAt: "desc" },
    select: { id: true },
  });
  if (exact) return exact.id;
  if (!embedding) return null;

  const literal = toVectorLiteral(embedding);
  const byAgent = agentId ? Prisma.sql`"agentId" = ${agentId}` : Prisma.sql`"agentId" IS NULL`;
  const rows = await prisma.$queryRaw<{ id: string; distance: number }[]>(Prisma.sql`
    SELECT id, embedding <=> ${literal}::vector AS distance
    FROM "KnowledgeGap"
    WHERE "tenantId" = ${tenantId} AND ${byAgent} AND status = 'open' AND embedding IS NOT NULL
    ORDER BY embedding <=> ${literal}::vector
    LIMIT 1`);
  const best = rows[0];
  return best && Number(best.distance) <= GROUP_MAX_DISTANCE ? best.id : null;
}
