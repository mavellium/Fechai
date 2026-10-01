import { prisma } from "@/lib/prisma";
import type { WhatsappHealth } from "./health";

/**
 * Registro das quedas do WhatsApp, para o relatório mensal dizer quanto do mês
 * o agente ficou no ar. O monitor de saúde já sabia que a conexão caiu; só não
 * guardava quando caiu e quando voltou.
 *
 * Só queda **comprovada** vira incidente: o provedor respondeu e disse que a
 * conexão não está aberta (ou que a instância sumiu), e o banco achava que
 * estava conectada. "Silencioso" é suspeita, não prova, e "indeterminado" é
 * problema nosso para perguntar — nenhum dos dois abre nem fecha nada.
 *
 * O início é o momento em que o monitor viu a queda: a queda real pode ter
 * começado até um ciclo antes. Nada aqui lança: é registro, e um registro que
 * derruba o monitor deixa a conta sem alerta.
 */
export async function trackWhatsappIncident(health: WhatsappHealth, now = new Date()): Promise<void> {
  const { tenantId, provider } = health;
  try {
    // A primeira varredura marca desde quando há medição; antes disso o
    // relatório diz "não medido".
    await prisma.tenant.updateMany({ where: { id: tenantId, uptimeTrackedSince: null }, data: { uptimeTrackedSince: now } });
    if (!health.reachable) {
      // Não deu para perguntar (`indeterminado`): mantém o que se sabia. Já o
      // "ok" sem consulta é conexão que não se monitora mais (sem instância,
      // Meta desligada no painel): uma queda aberta dela termina aqui.
      if (health.verdict === "ok") await closeWhatsappIncidents(tenantId, provider, now);
      return;
    }
    const down = !health.exists || health.liveStatus !== "connected";
    if (!down) { await closeWhatsappIncidents(tenantId, provider, now); return; }
    // Desconectado no painel não é queda nova: é estado conhecido. A queda que
    // o próprio monitor abriu segue aberta (ele já sincronizou o status).
    if (health.storedStatus !== "connected") return;
    const open = await prisma.whatsappIncident.findFirst({ where: { tenantId, provider, endedAt: null }, select: { id: true } });
    if (!open) await prisma.whatsappIncident.create({ data: { tenantId, provider, kind: health.exists ? "desconectado" : "sumiu", startedAt: now } });
  } catch (error) {
    console.error(`[whatsapp incidents] falha ao registrar ${tenantId}`, error);
  }
}

/**
 * Fecha as quedas abertas de uma conexão. Também chamada quando a pessoa
 * desconecta pelo painel: dali em diante o número está fora por decisão dela,
 * não por falha, e a queda não pode seguir contando contra o agente.
 */
export async function closeWhatsappIncidents(tenantId: string, provider: string, now = new Date()): Promise<void> {
  try {
    await prisma.whatsappIncident.updateMany({ where: { tenantId, provider, endedAt: null }, data: { endedAt: now } });
  } catch (error) {
    console.error(`[whatsapp incidents] falha ao fechar ${tenantId}`, error);
  }
}
