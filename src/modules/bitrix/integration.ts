import { z } from "zod";
import { ORIGIN, reference } from "./mirror";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret, isEncryptionConfigured } from "@/lib/crypto";
import { BitrixFailure, createBitrixClient, parseWebhook, verifyBitrix, externalId, itemList } from "./client";

export async function saveBitrix(tenantId: string, input: { webhook: string; syncLeads: boolean; syncAppointments: boolean; responsibleId: string }) {
  if (!isEncryptionConfigured()) throw new BitrixFailure("A conexão ainda não está disponível nesta instalação. Avise o suporte.");
  const previous = await prisma.bitrixIntegration.findUnique({ where: { tenantId } });
  const webhook = input.webhook.trim() || (previous?.webhook ? decryptSecret(previous.webhook) : null);
  if (!webhook) throw new BitrixFailure("Informe a URL do webhook de entrada do Bitrix24.");
  const target = parseWebhook(webhook);
  const responsibleId = input.responsibleId.trim() || target.userId;
  if (!/^[1-9]\d{0,14}$/.test(responsibleId)) throw new BitrixFailure("Informe um ID numérico válido para o responsável.");
  if (previous?.webhook && previous.portalHost !== target.host) {
    throw new BitrixFailure("Para usar outro portal, desconecte o atual e conecte o novo portal.");
  }
  const crmMode = await verifyBitrix(webhook, input.syncAppointments);
  const isNew = !previous || previous.portalHost !== target.host;
  const data = {
    webhook: encryptSecret(webhook), portalHost: target.host, enabled: true, crmMode,
    syncLeads: input.syncLeads, syncAppointments: input.syncAppointments, responsibleId, revision: randomUUID(),
    // Reset cursors when enabling a scope: older contacts/future appointments must be captured too.
    leadCursor: new Date(0), leadAfter: "", appointmentCursor: new Date(0), appointmentAfter: "",
  };
  await prisma.bitrixIntegration.upsert({ where: { tenantId },
    create: { tenantId, connectionKey: randomUUID(), ...data },
    update: { ...data, ...(isNew ? { connectedAt: new Date(), connectionKey: randomUUID(), lastSyncAt: null } : {}) },
  });
  await prisma.bitrixSyncJob.updateMany({ where: { tenantId, connectionKey: previous?.connectionKey ?? "", state: "retry" }, data: { nextAttemptAt: new Date() } });
}

export async function getBitrixStatus(tenantId: string) {
  // Explicit select. Neither plaintext nor encrypted credentials may cross the RSC boundary.
  const row = await prisma.bitrixIntegration.findUnique({ where: { tenantId }, select: {
    webhook: true, portalHost: true, connectionKey: true, enabled: true, syncLeads: true, syncAppointments: true,
    crmMode: true, responsibleId: true, lastSyncAt: true,
  } });
  if (!row) return null;
  const where = { tenantId, connectionKey: row.connectionKey };
  const [counts, errors, uncertain] = await Promise.all([
    prisma.bitrixSyncJob.groupBy({ by: ["state"], where, _count: { _all: true } }),
    prisma.bitrixSyncJob.findMany({ where: { ...where, state: "retry", lastError: { not: null } },
      select: { lastError: true }, orderBy: { updatedAt: "desc" }, take: 3 }),
    prisma.bitrixSyncJob.findMany({ where: { ...where, state: "retry", uncertain: { not: null } },
      select: { id: true, kind: true, uncertain: true, payload: true }, orderBy: { updatedAt: "asc" }, take: 10 }),
  ]);
  return { connected: Boolean(row.webhook), portalHost: row.portalHost, enabled: row.enabled, syncLeads: row.syncLeads, syncAppointments: row.syncAppointments,
    crmMode: row.crmMode, responsibleId: row.responsibleId, lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
    uncertain: uncertain.map((job) => {
      const source = z.object({ name: z.string().nullable().optional(), phone: z.string().optional(), title: z.string().optional() }).safeParse(job.payload);
      const type = job.uncertain === "activity" ? "Agendamento" : job.uncertain === "crm" ? "Lead ou negócio" : "Contato";
      const label = source.success ? source.data.title || source.data.name || (source.data.phone ? `Telefone final ${source.data.phone.slice(-4)}` : null) : null;
      return { id: job.id, label: `${type}${label ? ` · ${label.slice(0, 100)}` : ""}` };
    }),
    counts: Object.fromEntries(counts.map((c) => [c.state, c._count._all])), errors: [...new Set(errors.map((e) => e.lastError).filter(Boolean))] as string[],
  };
}

export async function testBitrix(tenantId: string) {
  const row = await prisma.bitrixIntegration.findUnique({ where: { tenantId } });
  const webhook = row?.webhook ? decryptSecret(row.webhook) : null;
  if (!webhook || !row) throw new BitrixFailure("Conecte o Bitrix24 antes de testar.");
  const mode = await verifyBitrix(webhook, row.syncAppointments);
  await prisma.bitrixIntegration.updateMany({ where: { tenantId, revision: row.revision }, data: { crmMode: mode } });
}
export async function setBitrixEnabled(tenantId: string, enabled: boolean) {
  const changed = await prisma.bitrixIntegration.updateMany({ where: { tenantId, ...(enabled ? { webhook: { not: null } } : {}) }, data: { enabled, revision: randomUUID() } });
  if (enabled && !changed.count) throw new BitrixFailure("Conecte o Bitrix24 antes de retomar a sincronização.");
  if (enabled) await retryBitrix(tenantId);
}
export async function disconnectBitrix(tenantId: string) {
  // Keep references and target identity for safe reconnection to the same portal.
  await prisma.bitrixIntegration.updateMany({ where: { tenantId }, data: { webhook: null, enabled: false, revision: randomUUID() } });
}
export async function retryBitrix(tenantId: string) {
  const row = await prisma.bitrixIntegration.findUnique({ where: { tenantId } });
  if (!row?.enabled || !row.webhook) throw new BitrixFailure("Ative a conexão antes de retomar os envios.");
  // Uncertain create flags are deliberately retained. Retry reconciles; never blind resends.
  await prisma.bitrixSyncJob.updateMany({ where: { tenantId, connectionKey: row.connectionKey, state: "retry" }, data: { nextAttemptAt: new Date() } });
}

export async function workerClient(tenantId: string, connectionKey: string, kind: string, canceled = false) {
  const row = await prisma.bitrixIntegration.findFirst({ where: { tenantId, connectionKey, enabled: true, tenant: { status: "active" } } });
  const webhook = row?.webhook ? decryptSecret(row.webhook) : null;
  if (!row || !webhook || (kind === "appointment" && !row.syncAppointments && !canceled)) return null;
  const call = createBitrixClient(webhook, async () => Boolean(await prisma.bitrixIntegration.findFirst({
    where: { tenantId, connectionKey, revision: row.revision, enabled: true, webhook: { not: null }, tenant: { status: "active" } }, select: { tenantId: true },
  })));
  return { row, call };
}


/** Only after the customer actually checks the portal. Reads the origin again under a claim;
 * finds late commits automatically, otherwise allows a new attempt after a grace period.
 */
export async function resolveUncertainBitrix(tenantId: string, id: string, confirmedMissing: boolean) {
  const row = await prisma.bitrixIntegration.findUnique({ where: { tenantId } });
  if (!row?.enabled || !row.webhook) throw new BitrixFailure("Ative a conexão antes de conferir este envio.");
  const job = await prisma.bitrixSyncJob.findFirst({ where: { id, tenantId, connectionKey: row.connectionKey, state: "retry", uncertain: { not: null } } });
  if (!job) throw new BitrixFailure("Este envio já foi resolvido ou pertence a outra conexão.");
  const token = randomUUID();
  const claimed = await prisma.bitrixSyncJob.updateMany({ where: { id, tenantId, connectionKey: row.connectionKey, state: "retry",
    OR: [{ lockedUntil: null }, { lockedUntil: { lte: new Date() } }],
  }, data: { lockedUntil: new Date(Date.now() + 300_000), lockToken: token } });
  if (!claimed.count) throw new BitrixFailure("Este envio está sendo conferido. Tente novamente em instantes.");
  try {
    const client = await workerClient(tenantId, row.connectionKey, "lead");
    if (!client) throw new BitrixFailure("A conexão foi alterada. Atualize o status e tente novamente.");
    const originId = reference(tenantId, row.connectionKey, job.uncertain === "contact" ? "contact" : job.uncertain === "crm" ? "crm" : "appointment", job.entityId);
    const found = job.uncertain === "activity"
      ? z.array(z.object({ ID: externalId })).parse(await client.call("crm.activity.list", { filter: { ORIGINATOR_ID: ORIGIN, ORIGIN_ID: originId }, select: ["ID"] })).map((item) => item.ID)
      : itemList.parse(await client.call("crm.item.list", { entityTypeId: job.uncertain === "contact" ? 3 : job.crmEntityType,
          select: ["id"], filter: { "=originatorId": ORIGIN, "=originId": originId } })).items.map((item) => item.id);
    if (found.length > 1) throw new BitrixFailure("Há registros duplicados com a referência do Fechai. Confira os duplicados antes de retomar.");
    if (!found.length && !confirmedMissing) throw new BitrixFailure("O registro ainda não foi encontrado. Confira o portal antes de permitir uma nova tentativa.");
    const saved = await prisma.bitrixSyncJob.updateMany({ where: { id, tenantId, lockToken: token }, data: {
      uncertain: null, state: "queued", lastError: null, nextAttemptAt: new Date(Date.now() + (found.length ? 0 : 300_000)),
      ...(found[0] ? job.uncertain === "activity" ? { activityId: found[0] } : job.uncertain === "contact" ? { contactId: found[0], contactManaged: true } : { crmId: found[0] } : {}),
    } });
    if (!saved.count) throw new BitrixFailure("O envio mudou durante a conferência. Atualize o status.");
    return found.length ? "Registro encontrado no Bitrix24. A sincronização será retomada." : "Nova tentativa permitida. Vamos conferir o portal novamente antes de criar o registro.";
  } finally {
    await prisma.bitrixSyncJob.updateMany({ where: { id, tenantId, lockToken: token }, data: { lockedUntil: null, lockToken: null } });
  }
}
