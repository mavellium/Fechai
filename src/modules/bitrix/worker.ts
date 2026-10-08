import { randomUUID } from "node:crypto";
import type { BitrixIntegration, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { BitrixFailure } from "./client";
import { workerClient } from "./integration";
import { appointmentPayload, fingerprint, leadPayload, mirrorAppointment, mirrorLead, type Links, type MirrorContext } from "./mirror";

const LEASE = 300_000;
const sourceLead = (lead: { id: string; name: string | null; phone: string; status: string }) =>
  ({ id: lead.id, name: lead.name, phone: lead.phone, status: lead.status });
const sourceAppointment = (a: { id: string; leadId: string | null; title: string; notes: string | null; startsAt: Date; endsAt: Date; status: string; patientName: string | null }) =>
  ({ id: a.id, leadId: a.leadId, title: a.title, notes: a.notes, startsAt: a.startsAt.toISOString(), endsAt: a.endsAt.toISOString(), status: a.status, patientName: a.patientName });
function version(payload: unknown, row: BitrixIntegration) {
  return fingerprint({ payload, syncLeads: row.syncLeads, syncAppointments: row.syncAppointments, responsibleId: row.responsibleId });
}
const jobKey = (tenantId: string, connectionKey: string, kind: string, entityId: string) =>
  ({ tenantId_connectionKey_kind_entityId: { tenantId, connectionKey, kind, entityId } });

export async function enqueueBitrix(row: BitrixIntegration, kind: string, entityId: string, payload: Prisma.InputJsonObject) {
  const hash = version(payload, row);
  const key = jobKey(row.tenantId, row.connectionKey, kind, entityId);
  const job = await prisma.bitrixSyncJob.upsert({ where: key, create: {
    tenantId: row.tenantId, connectionKey: row.connectionKey, kind, entityId, payload, fingerprint: hash,
  }, update: {}, select: { id: true } });
  // Retain remote IDs, uncertainty and the current claim. A newer source cannot be acknowledged by an older worker.
  await prisma.bitrixSyncJob.updateMany({ where: { id: job.id, tenantId: row.tenantId, fingerprint: { not: hash } },
    data: { payload, fingerprint: hash, state: "queued", nextAttemptAt: new Date(), lastError: null, attempts: 0 } });
}

/** Indexed incremental scans with a one-minute overlap after each completed batch.
 * Payload fingerprints suppress duplicates; timestamp + ID cursors avoid losing equal timestamps.
 */
export async function captureBitrix(row: BitrixIntegration, now = new Date()) {
  const upper = new Date(now.getTime() - 2000);
  const lower = (cursor: Date, after: string) => after ? cursor : new Date(Math.max(0, cursor.getTime() - 60_000));
  const leads = await prisma.lead.findMany({ where: { tenantId: row.tenantId, isTest: false,
    updatedAt: { gte: lower(row.leadCursor, row.leadAfter), lte: upper },
    ...(row.leadAfter ? { OR: [{ updatedAt: { gt: row.leadCursor } }, { updatedAt: row.leadCursor, id: { gt: row.leadAfter } }] } : {}),
  }, orderBy: [{ updatedAt: "asc" }, { id: "asc" }], take: 100 });
  for (const lead of leads) await enqueueBitrix(row, "lead", lead.id, sourceLead(lead));
  const last = leads.at(-1);
  const leadCursor = leads.length === 100 && last ? last.updatedAt : upper;
  const leadAfter = leads.length === 100 && last ? last.id : "";
  const appointments = await prisma.appointment.findMany({ where: { tenantId: row.tenantId,
    updatedAt: { gte: lower(row.appointmentCursor, row.appointmentAfter), lte: upper },
    ...(row.appointmentAfter ? { OR: [{ updatedAt: { gt: row.appointmentCursor } }, { updatedAt: row.appointmentCursor, id: { gt: row.appointmentAfter } }] } : {}),
  }, orderBy: [{ updatedAt: "asc" }, { id: "asc" }], take: 100 });
  for (const appointment of appointments) {
    const old = await prisma.bitrixSyncJob.findUnique({ where: jobKey(row.tenantId, row.connectionKey, "appointment", appointment.id), select: { activityId: true, uncertain: true } });
    if ((row.syncAppointments && appointment.startsAt >= row.connectedAt) || old?.activityId || old?.uncertain) {
      await enqueueBitrix(row, "appointment", appointment.id, sourceAppointment(appointment));
    }
  }
  const lastAppointment = appointments.at(-1);
  await prisma.bitrixIntegration.updateMany({ where: { tenantId: row.tenantId, connectionKey: row.connectionKey, revision: row.revision }, data: {
    leadCursor, leadAfter, appointmentCursor: appointments.length === 100 && lastAppointment ? lastAppointment.updatedAt : upper,
    appointmentAfter: appointments.length === 100 && lastAppointment ? lastAppointment.id : "",
  } });
}

export async function processBitrixJob(id: string, tenantId: string, now = new Date()) {
  let job = await prisma.bitrixSyncJob.findFirst({ where: { id, tenantId } });
  if (!job) return;
  const parsedAppointment = job.kind === "appointment" ? appointmentPayload.safeParse(job.payload) : null;
  const client = await workerClient(tenantId, job.connectionKey, job.kind, parsedAppointment?.success && parsedAppointment.data.status === "canceled");
  if (!client) return;
  const token = randomUUID();
  const claimed = await prisma.bitrixSyncJob.updateMany({ where: { id, tenantId, connectionKey: client.row.connectionKey,
    fingerprint: job.fingerprint, state: { in: ["queued", "retry", "processing"] }, nextAttemptAt: { lte: now },
    OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }],
  }, data: { state: "processing", lockToken: token, lockedUntil: new Date(now.getTime() + LEASE), attempts: { increment: 1 } } });
  if (!claimed.count) return;
  job = await prisma.bitrixSyncJob.findFirst({ where: { id, tenantId, lockToken: token } });
  if (!job) return;
  const ctx: MirrorContext = { tenantId, connectionKey: job.connectionKey, responsibleId: client.row.responsibleId,
    syncLeads: client.row.syncLeads, call: async (method, params) => {
      const owned = await prisma.bitrixSyncJob.updateMany({ where: { id, tenantId, lockToken: token }, data: { lockedUntil: new Date(Date.now() + LEASE) } });
      if (!owned.count) throw new BitrixFailure("O envio já está sendo conferido por outra tentativa.");
      return client.call(method, params);
    }, links: { contactId: job.contactId, contactManaged: job.contactManaged,
      crmId: job.crmId, crmEntityType: job.crmEntityType, activityId: job.activityId, uncertain: job.uncertain },
    persist: async (patch: Partial<Links>) => {
      const saved = await prisma.bitrixSyncJob.updateMany({ where: { id, tenantId, lockToken: token },
        data: { ...patch, lockedUntil: new Date(Date.now() + LEASE) } });
      if (!saved.count) throw new BitrixFailure("O envio já está sendo conferido por outra tentativa.");
    },
  };
  let state = "synced";
  let error: string | null = null;
  let delay = 60_000;
  try {
    if (job.kind === "lead") {
      const lead = await prisma.lead.findFirst({ where: { id: job.entityId, tenantId, isTest: false } });
      if (!lead) state = "skipped";
      else {
        const payload = sourceLead(lead);
        if (version(payload, client.row) !== job.fingerprint) { await enqueueBitrix(client.row, "lead", lead.id, payload); return; }
        await mirrorLead(ctx, leadPayload.parse(job.payload));
      }
    } else if (job.kind === "appointment") {
      const appointment = await prisma.appointment.findFirst({ where: { id: job.entityId, tenantId }, include: { lead: true } });
      if (!appointment || !appointment.lead || appointment.lead.tenantId !== tenantId || appointment.lead.isTest) state = "skipped";
      else {
        const payload = sourceAppointment(appointment);
        if (version(payload, client.row) !== job.fingerprint) { await enqueueBitrix(client.row, "appointment", appointment.id, payload); return; }
        await enqueueBitrix(client.row, "lead", appointment.lead.id, sourceLead(appointment.lead));
        let leadJob = await prisma.bitrixSyncJob.findUnique({ where: jobKey(tenantId, job.connectionKey, "lead", appointment.lead.id) });
        if (leadJob && !leadJob.contactId) {
          await processBitrixJob(leadJob.id, tenantId);
          leadJob = await prisma.bitrixSyncJob.findUnique({ where: jobKey(tenantId, job.connectionKey, "lead", appointment.lead.id) });
        }
        if (!leadJob?.contactId) throw new BitrixFailure("O agendamento aguarda a sincronização do contato no Bitrix24.");
        state = await mirrorAppointment(ctx, appointmentPayload.parse(job.payload), leadJob.contactId, `+${appointment.lead.phone.replace(/\D/g, "")}`);
      }
    } else state = "skipped";
  } catch (failure) {
    state = "retry";
    error = failure instanceof BitrixFailure ? failure.message : "Não foi possível confirmar a sincronização com o Bitrix24. O envio será conferido.";
    delay = Math.max(failure instanceof BitrixFailure ? failure.retryAfter : 60_000, Math.min(3_600_000, 30_000 * 2 ** Math.min(job.attempts, 7)));
  } finally {
    const finished = await prisma.bitrixSyncJob.updateMany({ where: { id, tenantId, lockToken: token, fingerprint: job.fingerprint }, data: {
      state, lastError: error, nextAttemptAt: new Date(Date.now() + delay), lockToken: null, lockedUntil: null,
    } });
    // Source changed during a POST. Preserve its queued state and the newly saved external IDs.
    if (!finished.count) await prisma.bitrixSyncJob.updateMany({ where: { id, tenantId, lockToken: token }, data: { lockToken: null, lockedUntil: null } });
    if (finished.count && state === "synced") await prisma.bitrixIntegration.updateMany({
      where: { tenantId, connectionKey: job.connectionKey, revision: client.row.revision }, data: { lastSyncAt: new Date() },
    });
  }
}

export async function scanBitrixSync() {
  const rows = await prisma.bitrixIntegration.findMany({ where: { enabled: true, webhook: { not: null }, tenant: { status: "active" } } });
  for (const row of rows) {
    try {
      await captureBitrix(row);
      for (const kind of ["lead", "appointment"]) {
        const jobs = await prisma.bitrixSyncJob.findMany({ where: { tenantId: row.tenantId, connectionKey: row.connectionKey, kind,
          state: { in: ["queued", "retry", "processing"] }, nextAttemptAt: { lte: new Date() },
          ...(!row.syncAppointments && kind === "appointment" ? { payload: { path: ["status"], equals: "canceled" } } : {}),
          OR: [{ lockedUntil: null }, { lockedUntil: { lte: new Date() } }],
        }, orderBy: { nextAttemptAt: "asc" }, take: kind === "lead" ? 3 : 2, select: { id: true } });
        for (const job of jobs) await processBitrixJob(job.id, row.tenantId);
      }
    } catch { console.error("[bitrix] Não foi possível concluir a sincronização de uma conta. A próxima varredura retomará os envios."); }
  }
}
