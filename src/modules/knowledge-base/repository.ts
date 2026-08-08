import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { deleteFromBunny } from "@/lib/bunny";
import { chunkText } from "./chunk";
import { embedTexts, isEmbeddingConfigured } from "./embeddings";

function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

// Ingesta um documento: cria o registro, quebra em chunks, gera embeddings
// (se configurado) e grava os vetores via SQL cru (coluna pgvector Unsupported).
// tenantId sempre presente — regra de ouro do multi-tenant. `agentId` escopa a
// base por agente (dois agentes da mesma conta não compartilham documentos).
export async function ingestDocument(input: {
  tenantId: string;
  agentId: string;
  title: string;
  content: string;
  fileUrl?: string;
  fileName?: string;
}) {
  const doc = await prisma.knowledgeDocument.create({
    data: {
      tenantId: input.tenantId,
      agentId: input.agentId,
      title: input.title,
      content: input.content,
      fileUrl: input.fileUrl,
      fileName: input.fileName,
      status: "pending",
    },
  });

  const chunks = chunkText(input.content);
  if (chunks.length === 0) {
    await prisma.knowledgeDocument.update({ where: { id: doc.id }, data: { status: "ready" } });
    return doc;
  }

  let embeddings: number[][] | null = null;
  try {
    embeddings = await embedTexts(chunks);
  } catch (err) {
    console.error("[knowledge-base] falha ao gerar embeddings", err);
  }

  for (let i = 0; i < chunks.length; i++) {
    const chunk = await prisma.knowledgeChunk.create({
      data: {
        tenantId: input.tenantId,
        agentId: input.agentId,
        documentId: doc.id,
        content: chunks[i],
      },
    });
    const vec = embeddings?.[i];
    if (vec) {
      await prisma.$executeRaw`
        UPDATE "KnowledgeChunk" SET embedding = ${toVectorLiteral(vec)}::vector WHERE id = ${chunk.id}`;
    }
  }

  const status = embeddings ? "ready" : isEmbeddingConfigured() ? "failed" : "no_embeddings";
  await prisma.knowledgeDocument.update({ where: { id: doc.id }, data: { status } });
  return { ...doc, status };
}

export async function listDocuments(tenantId: string, agentId: string) {
  return prisma.knowledgeDocument.findMany({
    where: { tenantId, agentId },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, status: true, createdAt: true, fileUrl: true, fileName: true },
  });
}

// Traz o texto extraído junto — só para a tela de ver/editar um documento, que
// precisa do conteúdo cru. `listDocuments` continua sem `content` de propósito
// (a lista não usa e o texto pode ser grande).
export async function getDocument(tenantId: string, agentId: string, documentId: string) {
  return prisma.knowledgeDocument.findFirst({
    where: { id: documentId, tenantId, agentId },
    select: {
      id: true,
      title: true,
      content: true,
      status: true,
      createdAt: true,
      fileUrl: true,
      fileName: true,
    },
  });
}

/**
 * Reescreve o texto de um documento existente: troca `content`, apaga os
 * chunks/embeddings antigos e gera novos a partir do texto editado. O arquivo
 * original (`fileUrl`/`fileName`) não muda — só o texto que o agente usa no RAG,
 * que pode divergir do PDF depois de editado (é a troca aceita ao permitir editar
 * texto extraído de PDF em vez de bloquear).
 */
export async function updateDocument(
  tenantId: string,
  agentId: string,
  documentId: string,
  input: { title: string; content: string },
) {
  const existing = await prisma.knowledgeDocument.findFirst({
    where: { id: documentId, tenantId, agentId },
    select: { id: true },
  });
  if (!existing) return null;

  await prisma.knowledgeDocument.update({
    where: { id: documentId },
    data: { title: input.title, content: input.content, status: "pending" },
  });
  await prisma.knowledgeChunk.deleteMany({ where: { documentId, tenantId } });

  const chunks = chunkText(input.content);
  if (chunks.length === 0) {
    return prisma.knowledgeDocument.update({ where: { id: documentId }, data: { status: "ready" } });
  }

  let embeddings: number[][] | null = null;
  try {
    embeddings = await embedTexts(chunks);
  } catch (err) {
    console.error("[knowledge-base] falha ao gerar embeddings (edição)", err);
  }

  for (let i = 0; i < chunks.length; i++) {
    const chunk = await prisma.knowledgeChunk.create({
      data: { tenantId, agentId, documentId, content: chunks[i] },
    });
    const vec = embeddings?.[i];
    if (vec) {
      await prisma.$executeRaw`
        UPDATE "KnowledgeChunk" SET embedding = ${toVectorLiteral(vec)}::vector WHERE id = ${chunk.id}`;
    }
  }

  const status = embeddings ? "ready" : isEmbeddingConfigured() ? "failed" : "no_embeddings";
  return prisma.knowledgeDocument.update({ where: { id: documentId }, data: { status } });
}

export async function deleteDocument(tenantId: string, documentId: string) {
  // Busca antes de apagar: é o único jeito de saber o fileUrl pra limpar a CDN.
  const doc = await prisma.knowledgeDocument.findFirst({
    where: { id: documentId, tenantId },
    select: { fileUrl: true },
  });
  // deleteMany com tenantId garante isolamento (não apaga doc de outro tenant).
  await prisma.knowledgeDocument.deleteMany({ where: { id: documentId, tenantId } });

  if (doc?.fileUrl) {
    const path = new URL(doc.fileUrl).pathname.replace(/^\//, "");
    await deleteFromBunny(path);
  }
}

// Busca semântica para o motor (Milestone 5). Retorna os trechos mais próximos
// da base DAQUELE agente — o filtro por agentId é o que impede o agente de
// vendas responder com documento do suporte.
export async function searchSimilarChunks(
  agentId: string,
  queryEmbedding: number[],
  limit = 4,
): Promise<{ content: string; distance: number }[]> {
  const literal = toVectorLiteral(queryEmbedding);
  return prisma.$queryRaw<{ content: string; distance: number }[]>(Prisma.sql`
    SELECT content, embedding <=> ${literal}::vector AS distance
    FROM "KnowledgeChunk"
    WHERE "agentId" = ${agentId} AND embedding IS NOT NULL
    ORDER BY embedding <=> ${literal}::vector
    LIMIT ${limit}`);
}
