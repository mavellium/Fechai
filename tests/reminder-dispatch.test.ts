import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ reminderDispatch: { upsert: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() }, reminderReceipt: { upsert: vi.fn(), findMany: vi.fn() } }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
import { blockReminder, claimReminder, finishReminder, markReminderManual, recordReminderReceipt, reminderAlreadyHandled, reminderSource } from "@/modules/scheduling/reminder-dispatch";
import { reminderStatusText } from "@/modules/scheduling/reminder-status";
import { parseEvolutionReminderReceipts } from "@/modules/whatsapp/reminder-receipts";
const key = { tenantId: "a", sourceKey: "clinicorp:123", startsAt: new Date("2030-01-01"), minutesBefore: 1440 };
beforeEach(() => {
  vi.clearAllMocks(); db.reminderDispatch.upsert.mockResolvedValue({ id: "r", state: "queued" });
  db.reminderDispatch.findUnique.mockResolvedValue(null); db.reminderDispatch.updateMany.mockResolvedValue({ count: 1 });
  db.reminderReceipt.findMany.mockResolvedValue([]);
});
describe("registro único e posse", () => {
  it("local espelhado e externo usam a mesma origem", () => expect(reminderSource("local", "123")).toBe(key.sourceKey));
  it("claim inclui tenant, instante e antecedência no upsert e tenant/estado no CAS", async () => {
    const claim = await claimReminder(key);
    expect(claim).toMatchObject({ tenantId: "a", id: "r" });
    expect(db.reminderDispatch.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: key }));
    expect(db.reminderDispatch.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "r", tenantId: "a", state: { in: ["queued", "blocked"] } } }));
  });
  it("claim perdido não permite envio", async () => { db.reminderDispatch.updateMany.mockResolvedValue({ count: 0 }); expect(await claimReminder(key)).toBeNull(); });
  it.each(["sent", "manual", "unknown", "skipped"])("estado %s não autoriza novo POST", async (state) => {
    db.reminderDispatch.upsert.mockResolvedValue({ id: "r", state }); expect(await claimReminder(key)).toBeNull(); expect(db.reminderDispatch.updateMany).not.toHaveBeenCalled();
  });
  it("POST abandonado vira incerto e nunca é recuperado para reenvio", async () => {
    db.reminderDispatch.upsert.mockResolvedValue({ id: "r", state: "sending", claimedAt: new Date(0), token: "old" });
    expect(await claimReminder(key)).toBeNull(); expect(db.reminderDispatch.updateMany.mock.calls[0][0].data.state).toBe("unknown");
  });
  it("manual não toma envio em andamento", async () => {
    db.reminderDispatch.upsert.mockResolvedValue({ id: "r", state: "sending" }); db.reminderDispatch.updateMany.mockResolvedValue({ count: 0 });
    expect(await markReminderManual(key, "user")).toBe(false);
    expect(db.reminderDispatch.updateMany.mock.calls[0][0].where.state.in).not.toContain("sending");
  });
  it("manual grava responsável e não simula entrega", async () => {
    await markReminderManual(key, "u"); expect(db.reminderDispatch.updateMany.mock.calls[0][0].data).toMatchObject({ state: "manual", manualBy: "u" });
    expect(db.reminderDispatch.updateMany.mock.calls[0][0].data.deliveryStatus).toBeUndefined();
  });
  it("impedimento não apaga estado terminal", async () => {
    await blockReminder(key, "Conexão fora"); expect(db.reminderDispatch.updateMany.mock.calls[0][0].where.state.in).toEqual(["queued", "blocked"]);
  });
  it("ack usa token e salva mensagem antes da reconciliação", async () => {
    await finishReminder({ id: "r", token: "t", tenantId: "a" }, "sent", { provider: "evolution", messageId: "m" });
    expect(db.reminderDispatch.updateMany.mock.calls[0][0].where).toMatchObject({ tenantId: "a", token: "t" });
    expect(db.reminderDispatch.updateMany.mock.calls[0][0].data).toMatchObject({ messageId: "m", state: "sent" });
  });
  it("resultado incerto é tratado mas não aceito", async () => {
    db.reminderDispatch.findUnique.mockResolvedValue({ state: "unknown", acceptedAt: null }); expect(await reminderAlreadyHandled(key)).toMatchObject({ state: "unknown" });
  });
});
describe("recibos", () => {
  it("recibo antecipado persiste sem mensagem e reconcilia quando ela chega", async () => {
    db.reminderReceipt.findMany.mockResolvedValue([{ status: "delivered", occurredAt: new Date() }]);
    await recordReminderReceipt("a", "meta", "m", "delivered", new Date());
    expect(db.reminderReceipt.upsert.mock.calls[0][0].create).toMatchObject({ tenantId: "a", provider: "meta", messageId: "m" });
    await finishReminder({ id: "r", token: "t", tenantId: "a" }, "sent", { provider: "meta", messageId: "m" });
    expect(db.reminderDispatch.updateMany.mock.calls.at(-1)?.[0].data.deliveryStatus).toBe("delivered");
  });
  it("falha atrasada não regride leitura nem reenvia", async () => {
    db.reminderReceipt.findMany.mockResolvedValue([{ status: "failed", occurredAt: new Date() }]);
    await recordReminderReceipt("a", "meta", "m", "failed", new Date());
    const mutation = db.reminderDispatch.updateMany.mock.calls.at(-1)?.[0];
    expect(mutation.where.OR[1].deliveryStatus.in).not.toContain("read");
    expect(mutation.data.state).toBeUndefined();
  });
  it("status arbitrário não entra no banco", async () => { await recordReminderReceipt("a", "meta", "m", "constructor", new Date()); expect(db.reminderReceipt.upsert).not.toHaveBeenCalled(); });
  it.each([[3, "delivered"], [4, "read"], ["ERROR", "failed"], ["SERVER_ACK", "sent"]])("parse de recibo Evolution %s", (status, expected) => {
    expect(parseEvolutionReminderReceipts({ event: "messages.update", instance: "inst", data: [{ key: { id: "m", fromMe: true }, update: { status } }] })).toEqual([{ instanceExternalId: "inst", messageId: "m", status: expected }]);
  });
  it("não trata mensagem comum/entrada como recibo", () => {
    expect(parseEvolutionReminderReceipts({ event: "messages.upsert", instance: "i", data: { keyId: "m", status: "READ" } })).toEqual([]);
    expect(parseEvolutionReminderReceipts({ event: "messages.update", instance: "i", data: { key: { id: "m", fromMe: false }, status: 3 } })).toEqual([]);
  });
  it("aceite sem recibo nunca se apresenta como entregue", () => {
    expect(reminderStatusText({ state: "sent", provider: "evolution", reason: null, deliveryStatus: null, at: null })).toContain("entrega ainda não confirmada");
  });
});
