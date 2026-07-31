import { prisma } from "../../src/lib/prisma";
import { getWhatsAppProvider } from "../../src/modules/whatsapp";

export const FOLLOWUP_TEXT =
  "Oi! Vi que nossa conversa ficou pela metade 😊 Posso te ajudar em mais alguma coisa?";

export function followUpDelayMs(): number {
  const minutes = Number(process.env.FOLLOWUP_DELAY_MINUTES ?? 1440); // 24h padrão
  return minutes * 60_000;
}

// Regra pura de elegibilidade — fácil de testar sem banco.
export function isEligible(
  conv: { needsHuman: boolean; followUpSentAt: Date | null; lastInboundAt: Date | null; lastRole?: string },
  cutoff: Date,
): boolean {
  if (conv.needsHuman) return false;
  if (conv.followUpSentAt) return false;
  if (!conv.lastInboundAt) return false;
  if (conv.lastInboundAt >= cutoff) return false;
  // só faz sentido se a última mensagem foi do agente (lead ficou em silêncio)
  if (conv.lastRole && conv.lastRole !== "assistant") return false;
  return true;
}

// Varre as conversas elegíveis dos tenants com a ação follow_up ativa e dispara.
export async function scanAndSendFollowUps(now: Date = new Date()) {
  const cutoff = new Date(now.getTime() - followUpDelayMs());

  const enabled = await prisma.tenantAction.findMany({
    where: { key: "follow_up", enabled: true },
    select: { tenantId: true },
  });
  const tenantIds = enabled.map((t) => t.tenantId);
  if (tenantIds.length === 0) return { scanned: 0, sent: 0 };

  const convos = await prisma.conversation.findMany({
    where: {
      tenantId: { in: tenantIds },
      needsHuman: false,
      followUpSentAt: null,
      lastInboundAt: { not: null, lt: cutoff },
    },
    include: { lead: true, messages: { orderBy: { createdAt: "desc" }, take: 1 } },
  });

  const provider = getWhatsAppProvider();
  let sent = 0;

  for (const c of convos) {
    if (!isEligible({ ...c, lastRole: c.messages[0]?.role }, cutoff)) continue;

    if (provider.isConfigured() && c.lead.phone !== "sandbox") {
      const instance = await prisma.whatsappInstance.findUnique({ where: { tenantId: c.tenantId } });
      if (instance?.externalId && instance.status === "connected") {
        try {
          await provider.sendMessage(instance.externalId, c.lead.phone, FOLLOWUP_TEXT);
        } catch (err) {
          console.error("[follow-up] falha ao enviar", c.id, err);
        }
      }
    }

    await prisma.message.create({
      data: { conversationId: c.id, role: "assistant", content: FOLLOWUP_TEXT },
    });
    await prisma.conversation.update({ where: { id: c.id }, data: { followUpSentAt: now } });
    sent++;
  }

  return { scanned: convos.length, sent };
}
