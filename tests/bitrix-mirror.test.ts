import { describe, expect, it, vi } from "vitest";
import { BitrixFailure } from "@/modules/bitrix/client";
import { activityFields, mirrorAppointment, mirrorLead, reference, type MirrorContext } from "@/modules/bitrix/mirror";
import { parseLocalDateTime } from "@/modules/scheduling/time";
const lead = { id: "lead-a", name: "Contato de teste", phone: "5511999991111", status: "scheduled" };
const appointment = { id: "appointment-a", leadId: lead.id, title: "Avaliação", notes: "Informação registrada pela clínica", patientName: "Paciente teste", status: "scheduled",
  startsAt: parseLocalDateTime("2026-10-20", "14:00", "America/Sao_Paulo")!.toISOString(), endsAt: "2026-10-20T17:30:00.000Z" };
function context(mode = 1) {
  const call = vi.fn<MirrorContext["call"]>().mockImplementation(async (method, params) => {
    if (method === "crm.item.list") return { items: [] };
    if (method === "crm.duplicate.findbycomm") return { CONTACT: [] };
    if (method === "crm.settings.mode.get") return mode;
    if (method === "crm.item.add") return { item: { id: params?.entityTypeId === 3 ? 11 : 22 } };
    if (method === "crm.item.update") return { item: { id: params?.id } };
    if (method === "crm.activity.list") return [];
    if (method === "crm.activity.add") return 33;
    if (method === "crm.activity.update") return true;
    throw new Error("Unexpected method");
  });
  const ctx: MirrorContext = { tenantId: "tenant-a", connectionKey: "portal-generation", responsibleId: "1", syncLeads: true, call,
    links: { contactId: null, contactManaged: false, crmId: null, crmEntityType: null, activityId: null, uncertain: null }, persist: vi.fn().mockResolvedValue(undefined) };
  return { ctx, call };
}
describe("Bitrix24: contatos, leads e negócios", () => {
  it.each([1, 2])("cria um contato e um registro no modo %s, sem mudar estágio ou valores", async (mode) => {
    const { ctx, call } = context(mode);
    await mirrorLead(ctx, lead);
    expect(ctx.links).toMatchObject({ contactId: "11", contactManaged: true, crmId: "22", crmEntityType: mode === 1 ? 1 : 2, uncertain: null });
    const adds = call.mock.calls.filter(([method]) => method === "crm.item.add");
    expect(adds).toHaveLength(2);
    expect(adds[0][1]).toMatchObject({ entityTypeId: 3, fields: { fm: [{ typeId: "PHONE", value: "+5511999991111" }], originatorId: "FECHAI" } });
    expect(adds[1][1]).toMatchObject({ entityTypeId: mode === 1 ? 1 : 2, fields: { contactIds: ["11"] } });
    for (const [method, params] of call.mock.calls) if (method === "crm.item.update") {
      expect(params?.fields).not.toHaveProperty("stageId"); expect(params?.fields).not.toHaveProperty("opportunity"); expect(params?.fields).not.toHaveProperty("assignedById");
    }
  });
  it("reusa o contato da recepção sem sobrescrever seus dados", async () => {
    const { ctx, call } = context();
    call.mockImplementationOnce(async () => ({ items: [] })).mockImplementationOnce(async () => ({ CONTACT: [99] }));
    await mirrorLead(ctx, lead);
    expect(ctx.links).toMatchObject({ contactId: "99", contactManaged: false });
    expect(call.mock.calls.filter(([method, params]) => method === "crm.item.update" && params?.entityTypeId === 3)).toHaveLength(0);
    expect(call.mock.calls.filter(([method, params]) => method === "crm.item.add" && params?.entityTypeId === 3)).toHaveLength(0);
  });
  it("não escolhe arbitrariamente entre contatos duplicados", async () => {
    const { ctx, call } = context();
    call.mockImplementationOnce(async () => ({ items: [] })).mockImplementationOnce(async () => ({ CONTACT: [98, 99] }));
    await expect(mirrorLead(ctx, lead)).rejects.toThrow("duplicados");
    expect(call.mock.calls.some(([method]) => method.endsWith(".add"))).toBe(false);
  });
  it("contatos continuam sendo enviados com leads desabilitados", async () => {
    const { ctx, call } = context(); ctx.syncLeads = false;
    await mirrorLead(ctx, lead);
    expect(ctx.links.contactId).toBe("11"); expect(ctx.links.crmId).toBeNull();
    expect(call.mock.calls.some(([method]) => method === "crm.settings.mode.get")).toBe(false);
  });
  it("grava incerteza antes de criar e nunca repete POST após timeout", async () => {
    const { ctx, call } = context();
    call.mockImplementationOnce(async () => ({ items: [] })).mockImplementationOnce(async () => ({ CONTACT: [] })).mockImplementationOnce(async () => {
      expect(ctx.links.uncertain).toBe("contact"); throw new BitrixFailure("Tempo esgotado", true);
    });
    await expect(mirrorLead(ctx, lead)).rejects.toThrow("Tempo esgotado");
    await expect(mirrorLead(ctx, lead)).rejects.toThrow("sem confirmação");
    expect(call.mock.calls.filter(([method]) => method === "crm.item.add")).toHaveLength(1);
    expect(ctx.links.uncertain).toBe("contact");
    call.mockImplementationOnce(async () => ({ items: [{ id: 11 }] }));
    await mirrorLead(ctx, lead);
    expect(ctx.links).toMatchObject({ contactId: "11", crmId: "22", uncertain: null });
  });
  it("erro explícito libera nova tentativa; retorno inválido mantém a incerteza", async () => {
    const { ctx, call } = context();
    call.mockImplementationOnce(async () => ({ items: [] })).mockImplementationOnce(async () => ({})).mockImplementationOnce(async () => { throw new BitrixFailure("Recusado", false); });
    await expect(mirrorLead(ctx, lead)).rejects.toThrow("Recusado"); expect(ctx.links.uncertain).toBeNull();
    call.mockImplementationOnce(async () => ({ items: [] })).mockImplementationOnce(async () => ({})).mockImplementationOnce(async () => ({ item: {} }));
    await expect(mirrorLead(ctx, lead)).rejects.toThrow(); expect(ctx.links.uncertain).toBe("contact");
  });
  it("referências separam tenants, portais e entidades", () => {
    const base = reference("a", "portal1", "contact", "1");
    for (const args of [["b", "portal1", "contact", "1"], ["a", "portal2", "contact", "1"], ["a", "portal1", "crm", "1"]]) expect(reference(...args as [string, string, string, string])).not.toBe(base);
  });
});
describe("Bitrix24: reuniões no calendário", () => {
  it("cria reunião ligada ao contato às 14h de São Paulo, com ID persistido", async () => {
    const { ctx, call } = context();
    expect(await mirrorAppointment(ctx, appointment, "11", "+5511999991111")).toBe("synced");
    expect(ctx.links.activityId).toBe("33");
    expect(call).toHaveBeenCalledWith("crm.activity.add", { fields: expect.objectContaining({ TYPE_ID: 1, OWNER_TYPE_ID: 3, OWNER_ID: "11", START_TIME: "2026-10-20T17:00:00.000Z", COMPLETED: "N", RESPONSIBLE_ID: "1" }) });
  });
  it("remarca no mesmo ID e preserva cancelamento nas observações sem deletar", async () => {
    const { ctx, call } = context(); ctx.links.activityId = "33";
    await mirrorAppointment(ctx, { ...appointment, startsAt: "2026-10-21T17:00:00.000Z" }, "11", "+5511999991111");
    await mirrorAppointment(ctx, { ...appointment, status: "canceled", notes: "Cancelado a pedido do contato" }, "11", "+5511999991111");
    const calls = call.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject(["crm.activity.update", { id: "33", fields: { START_TIME: "2026-10-21T17:00:00.000Z" } }]);
    expect(calls[1]).toMatchObject(["crm.activity.update", { id: "33", fields: { SUBJECT: "Cancelado · Avaliação", COMPLETED: "Y", DESCRIPTION: expect.stringContaining("Cancelado a pedido do contato") } }]);
  });
  it("não cria consulta já cancelada que nunca foi espelhada", async () => {
    const { ctx, call } = context();
    expect(await mirrorAppointment(ctx, { ...appointment, status: "canceled" }, "11", "+5511999991111")).toBe("skipped");
    expect(call.mock.calls.some(([method]) => method.endsWith(".add"))).toBe(false);
  });
  it("recupera criação sem resposta pelo ID de origem, sem repetir reunião", async () => {
    const { ctx, call } = context(); ctx.links.uncertain = "activity";
    call.mockImplementationOnce(async () => [{ ID: 33 }]);
    await mirrorAppointment(ctx, appointment, "11", "+5511999991111");
    expect(ctx.links).toMatchObject({ activityId: "33", uncertain: null });
    expect(call.mock.calls.some(([method]) => method === "crm.activity.add")).toBe(false);
  });
  it("não confunde HTTP 200 com atualização confirmada", async () => {
    const { ctx, call } = context(); ctx.links.activityId = "33"; call.mockResolvedValueOnce(false);
    await expect(mirrorAppointment(ctx, appointment, "11", "+5511999991111")).rejects.toThrow();
  });
  it("agendamento não marca comparecimento nem envia convite ao paciente", () => {
    const fields = activityFields(appointment, "11", "+5511999991111", "1");
    expect(fields.COMPLETED).toBe("N"); expect(fields.NOTIFY_TYPE).toBe(0); expect(fields).not.toHaveProperty("ATTENDEES"); expect(fields).not.toHaveProperty("attendance");
  });
});
