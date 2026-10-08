import { createHash } from "node:crypto";
import { z } from "zod";
import { BitrixFailure, externalId, itemList, itemResult, type BitrixCall } from "./client";

export const leadPayload = z.object({ id: z.string(), name: z.string().nullable(), phone: z.string(), status: z.string() });
export const appointmentPayload = z.object({ id: z.string(), leadId: z.string().nullable(), title: z.string(), notes: z.string().nullable(),
  startsAt: z.string().datetime(), endsAt: z.string().datetime(), status: z.string(), patientName: z.string().nullable() });
export type LeadPayload = z.infer<typeof leadPayload>;
export type AppointmentPayload = z.infer<typeof appointmentPayload>;
export type Links = { contactId: string | null; contactManaged: boolean; crmId: string | null; crmEntityType: number | null; activityId: string | null; uncertain: string | null };
export type MirrorContext = { tenantId: string; connectionKey: string; responsibleId: string; syncLeads: boolean;
  call: BitrixCall; links: Links; persist: (patch: Partial<Links>) => Promise<void> };
export const ORIGIN = "FECHAI";
export const reference = (tenantId: string, key: string, kind: string, id: string) =>
  createHash("sha256").update(JSON.stringify([tenantId, key, kind, id])).digest("hex");
export const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const CONFERENCE = "Um envio ficou sem confirmação. Estamos procurando o registro no Bitrix24 para evitar duplicação.";
async function persist(ctx: MirrorContext, patch: Partial<Links>) { await ctx.persist(patch); Object.assign(ctx.links, patch); }
async function findItem(ctx: MirrorContext, entityTypeId: number, kind: string, id: string) {
  const result = itemList.parse(await ctx.call("crm.item.list", { entityTypeId, select: ["id"],
    filter: { "=originatorId": ORIGIN, "=originId": reference(ctx.tenantId, ctx.connectionKey, kind, id) } }));
  if (result.items.length > 1) throw new BitrixFailure("Há mais de um registro com a referência do Fechai. Confira os duplicados no Bitrix24.");
  return result.items[0]?.id ?? null;
}
async function create(ctx: MirrorContext, kind: "contact" | "crm" | "activity", run: () => Promise<string>) {
  if (ctx.links.uncertain === kind) throw new BitrixFailure(CONFERENCE, false, 300_000);
  // Persist BEFORE POST. If the process dies at any point, the next worker only reconciles.
  await persist(ctx, { uncertain: kind });
  try { return await run(); }
  catch (error) {
    if (error instanceof BitrixFailure && !error.uncertain) await persist(ctx, { uncertain: null });
    throw error;
  }
}
const statuses: Record<string, string> = { new: "Novo", warm: "Em atendimento", hot: "Interessado", scheduled: "Agendou", lost: "Não agendou" };
function phoneOf(lead: LeadPayload) {
  const digits = lead.phone.replace(/\D/g, "");
  if (!/^[1-9]\d{9,14}$/.test(digits)) throw new BitrixFailure("O contato precisa de um telefone válido com código do país para ser enviado ao Bitrix24.");
  return `+${digits}`;
}
export async function mirrorLead(ctx: MirrorContext, lead: LeadPayload) {
  const phone = phoneOf(lead);
  if (!ctx.links.contactId) {
    let id = await findItem(ctx, 3, "contact", lead.id);
    let managed = Boolean(id);
    if (!id && ctx.links.uncertain !== "contact") {
      const duplicates = z.union([z.array(z.never()), z.object({ CONTACT: z.array(externalId).optional() }).passthrough()])
        .parse(await ctx.call("crm.duplicate.findbycomm", { entity_type: "CONTACT", type: "PHONE", values: [phone] }));
      const matches = Array.isArray(duplicates) ? [] : duplicates.CONTACT ?? [];
      if (matches.length > 1) throw new BitrixFailure("Há contatos duplicados com este telefone no Bitrix24. Una os contatos antes de sincronizar.");
      id = matches[0] ?? null;
    }
    if (!id) {
      id = await create(ctx, "contact", async () => itemResult.parse(await ctx.call("crm.item.add", { entityTypeId: 3, fields: {
        name: lead.name?.trim() || "Contato Fechai", assignedById: ctx.responsibleId,
        fm: [{ typeId: "PHONE", valueType: "WORK", value: phone }],
        originatorId: ORIGIN, originId: reference(ctx.tenantId, ctx.connectionKey, "contact", lead.id),
      } })).item.id);
      managed = true;
    }
    await persist(ctx, { contactId: id, contactManaged: managed, uncertain: null });
  }
  // Reused reception contacts keep all their fields. Owned contacts only receive the supplied name.
  if (ctx.links.contactManaged && lead.name?.trim()) {
    itemResult.parse(await ctx.call("crm.item.update", { entityTypeId: 3, id: ctx.links.contactId, fields: { name: lead.name.trim() } }));
  }
  if (!ctx.syncLeads) return;
  let entityType = ctx.links.crmEntityType;
  if (!entityType || (!ctx.links.crmId && ctx.links.uncertain !== "crm")) {
    const mode = z.union([z.literal(1), z.literal(2)]).parse(Number(await ctx.call("crm.settings.mode.get")));
    entityType = mode === 1 ? 1 : 2;
    await persist(ctx, { crmEntityType: entityType });
  }
  const fields: Record<string, unknown> = {
    title: `Fechai · ${lead.name?.trim() || phone}`, contactIds: [ctx.links.contactId],
    comments: `Origem: Fechai. Situação no Fechai: ${statuses[lead.status] ?? "Em atendimento"}.`,
  };
  if (!ctx.links.crmId) {
    const id = await findItem(ctx, entityType, "crm", lead.id) ?? await create(ctx, "crm", async () =>
      itemResult.parse(await ctx.call("crm.item.add", { entityTypeId: entityType, fields: {
        ...fields, ...(entityType === 1 ? { name: lead.name?.trim() || "Contato Fechai", fm: [{ typeId: "PHONE", valueType: "WORK", value: phone }] } : {}),
        assignedById: ctx.responsibleId, originatorId: ORIGIN, originId: reference(ctx.tenantId, ctx.connectionKey, "crm", lead.id),
      } })).item.id);
    await persist(ctx, { crmId: id, uncertain: null });
  }
  // Funnel/stage, money and responsible chosen in Bitrix are never inferred from Fechai status.
  itemResult.parse(await ctx.call("crm.item.update", { entityTypeId: entityType, id: ctx.links.crmId, fields }));
}

export function activityFields(appointment: AppointmentPayload, contactId: string, phone: string, responsibleId: string) {
  const canceled = appointment.status === "canceled";
  return {
    OWNER_TYPE_ID: 3, OWNER_ID: contactId, TYPE_ID: 1,
    SUBJECT: `${canceled ? "Cancelado · " : ""}${appointment.title}`,
    DESCRIPTION: ["Agendamento pelo Fechai.", appointment.patientName ? `Paciente: ${appointment.patientName}` : null,
      canceled ? "Consulta cancelada. Registro mantido para histórico." : null, appointment.notes].filter(Boolean).join("\n"),
    DESCRIPTION_TYPE: 1, START_TIME: appointment.startsAt, END_TIME: appointment.endsAt,
    COMPLETED: canceled ? "Y" : "N", RESPONSIBLE_ID: responsibleId, NOTIFY_TYPE: 0,
    COMMUNICATIONS: [{ VALUE: phone, ENTITY_ID: contactId, ENTITY_TYPE_ID: 3 }],
  };
}
export async function mirrorAppointment(ctx: MirrorContext, appointment: AppointmentPayload, contactId: string, phone: string) {
  if (!ctx.links.activityId) {
    const rows = z.array(z.object({ ID: externalId }).passthrough()).parse(await ctx.call("crm.activity.list", {
      filter: { ORIGINATOR_ID: ORIGIN, ORIGIN_ID: reference(ctx.tenantId, ctx.connectionKey, "appointment", appointment.id) }, select: ["ID"],
    }));
    if (rows.length > 1) throw new BitrixFailure("Há reuniões duplicadas com a referência do Fechai. Confira a agenda do Bitrix24.");
    if (rows[0]) await persist(ctx, { activityId: rows[0].ID, uncertain: null });
  }
  if (appointment.status === "canceled" && !ctx.links.activityId && ctx.links.uncertain !== "activity") return "skipped" as const;
  const fields = activityFields(appointment, contactId, phone, ctx.responsibleId);
  if (!ctx.links.activityId) {
    const id = await create(ctx, "activity", async () => externalId.parse(await ctx.call("crm.activity.add", { fields: {
      ...fields, ORIGINATOR_ID: ORIGIN, ORIGIN_ID: reference(ctx.tenantId, ctx.connectionKey, "appointment", appointment.id),
    } })));
    await persist(ctx, { activityId: id, uncertain: null });
  } else {
    z.literal(true).parse(await ctx.call("crm.activity.update", { id: ctx.links.activityId, fields }));
  }
  return "synced" as const;
}
