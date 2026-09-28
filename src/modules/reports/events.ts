import { prisma } from "@/lib/prisma";

/** Observação best-effort: relatórios nunca derrubam o atendimento/webhook. */
export async function recordReportEvent(input: {
  tenantId: string; conversationId: string; kind: "qualified" | "handoff" | "unanswered";
  procedure?: string; sourceKey?: string;
}) {
  try {
    const conversation = await prisma.conversation.findFirst({
      where: { id: input.conversationId, tenantId: input.tenantId, isTest: false, lead: { isTest: false } },
      select: { id: true, messages: { where: { role: "user" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { id: true } } },
    });
    if (!conversation || !conversation.messages[0]) return;
    const dedupKey = `${input.tenantId}:${conversation.id}:${input.kind}:${input.sourceKey ?? conversation.messages[0].id}`;
    await prisma.reportEvent.upsert({
      where: { dedupKey }, update: {},
      create: { tenantId: input.tenantId, conversationId: conversation.id, kind: input.kind,
        procedure: input.procedure?.trim().slice(0, 100) || null, dedupKey },
    });
  } catch (error) {
    console.error("[reports] evento não registrado", error);
  }
}
