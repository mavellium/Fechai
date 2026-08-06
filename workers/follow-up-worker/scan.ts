import { prisma } from "../../src/lib/prisma";
import { getWhatsAppProvider } from "../../src/modules/whatsapp";
import { parseFollowUpConfig, type FollowUpConfig } from "../../src/modules/follow-up/config";

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

// Varre as conversas elegíveis dos agentes com a ação follow_up ativa e dispara.
export async function scanAndSendFollowUps(now: Date = new Date()) {
  // O intervalo é por agente (TenantAction.config, ver módulo follow-up) —
  // cada agente da conta pode ter o dele. Por isso não dá mais para filtrar
  // por um `cutoff` só na query: busca sem filtro de data e decide na volta.
  const enabled = await prisma.tenantAction.findMany({
    where: { key: "follow_up", enabled: true },
    select: { tenantId: true, agentId: true, config: true },
  });
  if (enabled.length === 0) return { scanned: 0, sent: 0 };

  const configByAgent = new Map<string, FollowUpConfig>(
    enabled.map((a) => [a.agentId, parseFollowUpConfig(a.config)]),
  );
  const tenantIds = [...new Set(enabled.map((a) => a.tenantId))];

  const convos = await prisma.conversation.findMany({
    where: {
      tenantId: { in: tenantIds },
      // Conversa de teste não recebe follow-up: ninguém do outro lado para
      // reengajar (antes o filtro era pelo telefone "sandbox", mais abaixo).
      isTest: false,
      needsHuman: false,
      followUpSentAt: null,
      lastInboundAt: { not: null },
    },
    include: { lead: true, messages: { orderBy: { createdAt: "desc" }, take: 1 } },
  });

  const provider = getWhatsAppProvider();
  let sent = 0;

  for (const c of convos) {
    // Conversa de um agente que não tem follow_up ligado (mesmo que outro
    // agente da mesma conta tenha) não entra — a ação é por agente.
    const config = c.agentId ? configByAgent.get(c.agentId) : undefined;
    if (!config) continue;

    const cutoff = new Date(now.getTime() - config.delayHours * 60 * 60_000);
    if (!isEligible({ ...c, lastRole: c.messages[0]?.role }, cutoff)) continue;

    if (provider.isConfigured() && !c.lead.isTest) {
      const instance = await prisma.whatsappInstance.findUnique({ where: { tenantId: c.tenantId } });
      if (instance?.externalId && instance.status === "connected") {
        try {
          await provider.sendMessage(instance.externalId, c.lead.phone, config.message);
        } catch (err) {
          console.error("[follow-up] falha ao enviar", c.id, err);
        }
      }
    }

    await prisma.message.create({
      data: { conversationId: c.id, role: "assistant", content: config.message },
    });
    await prisma.conversation.update({ where: { id: c.id }, data: { followUpSentAt: now } });
    sent++;
  }

  return { scanned: convos.length, sent };
}
