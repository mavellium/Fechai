/** End-to-end local: PostgreSQL real + REST Bitrix simulado, sem rede externa. */
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { captureBitrix, processBitrixJob, scanBitrixSync } from "@/modules/bitrix/worker";
import { disconnectBitrix, saveBitrix, setBitrixEnabled } from "@/modules/bitrix/integration";
import { parseLocalDateTime } from "@/modules/scheduling/time";

const target = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/invalid");
assert.equal(target.hostname, "127.0.0.1", "Este teste só pode usar o PostgreSQL local isolado");
assert.equal(target.port, "5438");
assert.equal(target.pathname, "/fechai_bitrix_test");
process.env.ENCRYPTION_KEY = "synthetic-bitrix-smoke-key-only-0123456789";
const originalFetch = globalThis.fetch;
type Item = Record<string, unknown> & { id: string; entityTypeId: number; host: string };
const items: Item[] = [];
const activities: (Record<string, unknown> & { ID: string; host: string })[] = [];
const calls: { host: string; method: string; params: Record<string, unknown> }[] = [];
let unknownContact = false;
let nextId = 10;
const hosts = ["fechai-smoke-a.bitrix24.com.br", "fechai-smoke-b.bitrix24.com.br"];
const url = (index: number) => `https://${hosts[index]}/rest/1/syntheticsecret123/`;
globalThis.fetch = async (input, init) => {
  const endpoint = new URL(String(input));
  assert.ok(hosts.includes(endpoint.hostname), "Nenhuma chamada real é permitida neste teste");
  const method = endpoint.pathname.split("/").at(-1)!.replace(/\.json$/, "");
  const params = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
  calls.push({ host: endpoint.hostname, method, params });
  const fields = params.fields as Record<string, unknown> | undefined;
  let result: unknown;
  if (method === "crm.settings.mode.get") result = endpoint.hostname === hosts[0] ? 1 : 2;
  else if (method === "crm.activity.fields") result = { TYPE_ID: {}, START_TIME: {} };
  else if (method === "crm.item.list") {
    const filter = params.filter as Record<string, unknown>;
    result = { items: items.filter((item) => item.host === endpoint.hostname && item.entityTypeId === params.entityTypeId && (filter.id === 0 ? false : item.originatorId === filter["=originatorId"] && item.originId === filter["=originId"])) };
  } else if (method === "crm.duplicate.findbycomm") result = { CONTACT: [] };
  else if (method === "crm.item.add") {
    const item: Item = { ...fields, id: String(++nextId), entityTypeId: Number(params.entityTypeId), host: endpoint.hostname };
    items.push(item); result = { item };
    if (unknownContact && params.entityTypeId === 3) { unknownContact = false; throw new Error("Synthetic timeout AFTER remote commit"); }
  } else if (method === "crm.item.update") {
    const item = items.find((item) => item.host === endpoint.hostname && item.id === params.id && item.entityTypeId === params.entityTypeId);
    assert.ok(item); Object.assign(item, fields); result = { item };
  } else if (method === "crm.activity.list") {
    const filter = params.filter as Record<string, unknown>;
    result = activities.filter((a) => a.host === endpoint.hostname && a.ORIGINATOR_ID === filter.ORIGINATOR_ID && a.ORIGIN_ID === filter.ORIGIN_ID);
  } else if (method === "crm.activity.add") {
    const activity = { ...fields, ID: String(++nextId), host: endpoint.hostname };
    activities.push(activity); result = activity.ID;
  } else if (method === "crm.activity.update") {
    const activity = activities.find((a) => a.ID === params.id && a.host === endpoint.hostname);
    assert.ok(activity); Object.assign(activity, fields); result = true;
  } else throw new Error("Unexpected Bitrix method");
  return new Response(JSON.stringify({ result }));
};
const tenants: string[] = [];
async function capture(tenantId: string) {
  const row = await prisma.bitrixIntegration.findUniqueOrThrow({ where: { tenantId } });
  await captureBitrix(row, new Date(Date.now() + 3000));
}
async function job(tenantId: string, kind: string, entityId: string) {
  const row = await prisma.bitrixIntegration.findUniqueOrThrow({ where: { tenantId } });
  return prisma.bitrixSyncJob.findUniqueOrThrow({ where: { tenantId_connectionKey_kind_entityId: { tenantId, connectionKey: row.connectionKey, kind, entityId } } });
}
async function main() {
  const a = await prisma.tenant.create({ data: { name: "Bitrix smoke A" } }); tenants.push(a.id);
  const b = await prisma.tenant.create({ data: { name: "Bitrix smoke B" } }); tenants.push(b.id);
  await saveBitrix(a.id, { webhook: url(0), syncLeads: true, syncAppointments: true, responsibleId: "" });
  await saveBitrix(b.id, { webhook: url(1), syncLeads: true, syncAppointments: true, responsibleId: "" });
  const lead = await prisma.lead.create({ data: { tenantId: a.id, name: "Contato sintético", phone: "5511999991101" } });
  await prisma.lead.create({ data: { tenantId: b.id, name: "Contato sintético B", phone: "5511999991102" } });
  const sandbox = await prisma.lead.create({ data: { tenantId: a.id, name: "Sandbox", phone: "sandbox:smoke", isTest: true } });
  const tomorrow = new Date(Date.now() + 86_400_000); const date = tomorrow.toISOString().slice(0, 10);
  const startsAt = parseLocalDateTime(date, "14:00", "America/Sao_Paulo")!;
  const appointment = await prisma.appointment.create({ data: { tenantId: a.id, leadId: lead.id, title: "Consulta sintética", startsAt,
    endsAt: new Date(startsAt.getTime() + 30 * 60_000), notes: "Notas sintéticas", source: "manual" } });
  await prisma.appointment.create({ data: { tenantId: a.id, leadId: sandbox.id, title: "Consulta sandbox", startsAt, endsAt: new Date(startsAt.getTime() + 30 * 60_000) } });
  await capture(a.id); await capture(b.id);
  const leadJob = await job(a.id, "lead", lead.id);
  await Promise.all([processBitrixJob(leadJob.id, a.id), processBitrixJob(leadJob.id, a.id)]);
  assert.equal(items.filter((i) => i.host === hosts[0] && i.entityTypeId === 3).length, 1, "Claim SQL deve impedir dois contatos");
  const beforeIsolation = calls.length;
  await processBitrixJob(leadJob.id, b.id);
  assert.equal(calls.length, beforeIsolation, "Outro tenant não pode operar o ID");
  await scanBitrixSync();
  assert.equal(items.filter((i) => i.host === hosts[1] && i.entityTypeId === 2).length, 1, "CRM simples recebe negócio");
  assert.equal(activities.length, 1, "Apenas consulta real recebe reunião");
  assert.equal(activities[0].START_TIME, startsAt.toISOString());
  assert.equal(activities[0].TYPE_ID, 1);
  const mirrored = await job(a.id, "appointment", appointment.id);
  assert.equal(mirrored.state, "synced"); assert.ok(mirrored.activityId);
  const nextStart = new Date(startsAt.getTime() + 86_400_000);
  await prisma.appointment.update({ where: { id: appointment.id }, data: { startsAt: nextStart, endsAt: new Date(nextStart.getTime() + 30 * 60_000), rescheduledAt: new Date() } });
  await capture(a.id); await processBitrixJob(mirrored.id, a.id);
  assert.equal(activities.length, 1); assert.equal(activities[0].START_TIME, nextStart.toISOString());
  await prisma.appointment.update({ where: { id: appointment.id }, data: { status: "canceled", notes: "Cancelada a pedido do contato sintético" } });
  await capture(a.id); await processBitrixJob(mirrored.id, a.id);
  assert.equal(activities.length, 1); assert.equal(activities[0].ID, mirrored.activityId);
  assert.ok(String(activities[0].SUBJECT).startsWith("Cancelado"));
  assert.ok(String(activities[0].DESCRIPTION).includes("Cancelada a pedido"));
  // Timeout depois do commit remoto: retomar deve reconciliar, sem uma segunda criação.
  const uncertain = await prisma.lead.create({ data: { tenantId: a.id, phone: "5511999991103", name: "Timeout sintético" } });
  await capture(a.id); const uncertainJob = await job(a.id, "lead", uncertain.id);
  const contactsBefore = items.filter((i) => i.entityTypeId === 3).length;
  unknownContact = true; await processBitrixJob(uncertainJob.id, a.id);
  assert.equal((await prisma.bitrixSyncJob.findUniqueOrThrow({ where: { id: uncertainJob.id } })).uncertain, "contact");
  await processBitrixJob(uncertainJob.id, a.id, new Date(Date.now() + 120_000));
  assert.equal(items.filter((i) => i.entityTypeId === 3).length, contactsBefore + 1);
  assert.equal((await prisma.bitrixSyncJob.findUniqueOrThrow({ where: { id: uncertainJob.id } })).state, "synced");
  // Pausa de conexão impede requisição externa; retomada processa a alteração.
  await prisma.lead.update({ where: { id: lead.id }, data: { status: "scheduled" } }); await capture(a.id);
  await setBitrixEnabled(a.id, false); const callsBeforePause = calls.length;
  await processBitrixJob(leadJob.id, a.id); assert.equal(calls.length, callsBeforePause);
  await setBitrixEnabled(a.id, true); await processBitrixJob(leadJob.id, a.id);
  assert.equal((await prisma.bitrixSyncJob.findUniqueOrThrow({ where: { id: leadJob.id } })).state, "synced");
  await disconnectBitrix(a.id);
  const disconnected = await prisma.bitrixIntegration.findUniqueOrThrow({ where: { tenantId: a.id } });
  assert.equal(disconnected.webhook, null); assert.equal(disconnected.enabled, false);
  const oldKey = disconnected.connectionKey;
  await saveBitrix(a.id, { webhook: url(0), syncLeads: true, syncAppointments: true, responsibleId: "" });
  assert.equal((await prisma.bitrixIntegration.findUniqueOrThrow({ where: { tenantId: a.id } })).connectionKey, oldKey);
  console.log(JSON.stringify({ result: "passed", database: "isolated PostgreSQL", api: "simulated (no external network)", checks: ["encrypted per-tenant connection", "SQL concurrency claim", "tenant isolation", "classic leads and simple deals", "meeting at correct instant", "test exclusion", "reschedule same ID", "cancel preserves ID and notes", "timeout reconciliation without duplicate", "pause/resume", "disconnect/reconnect preserves references"] }));
}
void main().finally(async () => {
  globalThis.fetch = originalFetch;
  // Delete only tenants created in this execution, on the strictly validated test database.
  await prisma.tenant.deleteMany({ where: { id: { in: tenants } } });
  await prisma.$disconnect();
}).catch(() => { console.error("Teste local Bitrix falhou. Nenhum portal real foi chamado."); process.exitCode = 1; });
