import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ message: { findFirst: vi.fn() }, reportEvent: { upsert: vi.fn() }, conversation: { findMany: vi.fn() } }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
import { recordMessageContext, contextEventMessageId } from "@/modules/reports/contact-context-events";
import { loadConversationStarts } from "@/modules/reports/contact-context-store";
beforeEach(() => { vi.resetAllMocks(); vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => vi.restoreAllMocks());
describe("contexto de envio, sem interpretação nem interferência", () => {
  it("registra propósito até na primeira mensagem, com tenant, exclusão de testes e deduplicação", async () => {
    const at = new Date("2026-09-01T12:00:00Z");
    db.message.findFirst.mockResolvedValue({ id: "m", conversationId: "c", createdAt: at });
    await recordMessageContext("t", "m", "contact_reminder");
    expect(db.message.findFirst.mock.calls[0][0].where).toEqual({ id: "m", role: "assistant", conversation: { tenantId: "t", isTest: false, lead: { isTest: false } } });
    expect(db.reportEvent.upsert.mock.calls[0][0]).toEqual({ where: { dedupKey: "contact-context:t:c:contact_reminder:m" }, update: {},
      create: { tenantId: "t", conversationId: "c", kind: "contact_reminder", dedupKey: "contact-context:t:c:contact_reminder:m", createdAt: at } });
    expect(contextEventMessageId("contact_reminder", "contact-context:t:c:contact_reminder:m")).toBe("m");
    expect(contextEventMessageId("qualified", "contact-context:t:c:qualified:m")).toBeUndefined();
  });
  it("não grava mensagem de outro tenant, de teste ou sem id", async () => {
    db.message.findFirst.mockResolvedValue(null);
    await recordMessageContext("t", "outside", "contact_campaign");
    await recordMessageContext("t", undefined, "contact_campaign");
    expect(db.reportEvent.upsert).not.toHaveBeenCalled();
    expect(db.message.findFirst).toHaveBeenCalledTimes(1);
  });
  it("nunca interrompe um envio já realizado quando o registro falha", async () => {
    db.message.findFirst.mockRejectedValue(new Error("unavailable"));
    await expect(recordMessageContext("t", "m", "contact_followup")).resolves.toBeUndefined();
  });
  it("lê apenas metadados do início e da borda da janela, nunca texto/nome/telefone", async () => {
    const first = { id: "first", role: "user", sentBy: null, createdAt: new Date("2026-08-01T12:00:00Z") };
    const before = { ...first, id: "last", createdAt: new Date("2026-09-01T02:59:00Z") };
    db.conversation.findMany.mockResolvedValueOnce([{ id: "c", lead: { createdAt: first.createdAt }, messages: [first] }])
      .mockResolvedValueOnce([{ id: "c", messages: [before] }]);
    const starts = await loadConversationStarts("t", ["c"], new Date("2026-10-01T03:00:00Z"), new Date("2026-09-01T03:00:00Z"));
    expect(starts.get("c")).toMatchObject({ id: "first", contactCreatedAt: first.createdAt, beforeWindow: { id: "last" } });
    for (const [call] of db.conversation.findMany.mock.calls) {
      expect(call.where).toMatchObject({ tenantId: "t", isTest: false, lead: { isTest: false }, id: { in: ["c"] } });
      expect(call.select.messages.select).toEqual({ id: true, role: true, sentBy: true, createdAt: true });
      expect(call.select.messages.take).toBe(1);
    }
  });
});
