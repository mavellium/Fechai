"use server";

import { revalidatePath } from "next/cache";
import { requireProductAccess } from "@/lib/require-product";
import { requireTenant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import type { ActionResult } from "@/components/ui/toast/types";
import { BitrixFailure } from "@/modules/bitrix/client";
import { disconnectBitrix, retryBitrix, resolveUncertainBitrix, saveBitrix, setBitrixEnabled, testBitrix } from "@/modules/bitrix/integration";

async function guard() {
  await requireProductAccess();
  const { tenantId } = await requireTenant();
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { status: true } });
  return { tenantId, active: tenant?.status === "active" };
}
const inactive: ActionResult = { ok: false, error: "Esta conta precisa estar ativa para gerenciar a integração.", code: "forbidden" };
const resultError = (error: unknown): ActionResult => ({ ok: false,
  error: error instanceof BitrixFailure ? error.message : "Não foi possível concluir a operação. Tente novamente.", code: "server" });

export async function saveBitrixAction(_previous: ActionResult | null, data: FormData): Promise<ActionResult> {
  const access = await guard();
  if (!access.active) return inactive;
  const webhook = String(data.get("webhook") ?? "");
  if (webhook.length > 512) return { ok: false, error: "Confira a URL do webhook.", code: "validation" };
  try {
    await saveBitrix(access.tenantId, { webhook, syncLeads: data.get("syncLeads") === "on",
      syncAppointments: data.get("syncAppointments") === "on", responsibleId: String(data.get("responsibleId") ?? "") });
    revalidatePath("/integracoes");
    return { ok: true, info: "Bitrix24 conectado. Os registros serão enviados automaticamente." };
  } catch (error) { return resultError(error); }
}

export async function manageBitrixAction(_previous: ActionResult | null, data: FormData): Promise<ActionResult> {
  const access = await guard();
  if (!access.active) return inactive;
  const operation = data.get("operation");
  try {
    let info: string;
    if (operation === "test") { await testBitrix(access.tenantId); info = "Conexão validada. O teste não cria registros no CRM."; }
    else if (operation === "pause") { await setBitrixEnabled(access.tenantId, false); info = "Sincronização pausada."; }
    else if (operation === "resume") { await setBitrixEnabled(access.tenantId, true); info = "Sincronização retomada."; }
    else if (operation === "disconnect") { await disconnectBitrix(access.tenantId); info = "Bitrix24 desconectado. O histórico foi preservado."; }
    else if (operation === "resolve") {
      const id = String(data.get("jobId") ?? "");
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) return { ok: false, error: "Escolha um envio válido.", code: "validation" };
      info = await resolveUncertainBitrix(access.tenantId, id, data.get("confirmedMissing") === "on");
    }
    else if (operation === "retry") { await retryBitrix(access.tenantId); info = "Os envios serão conferidos novamente."; }
    else return { ok: false, error: "Escolha uma operação válida.", code: "validation" };
    revalidatePath("/integracoes");
    return { ok: true, info };
  } catch (error) { return resultError(error); }
}
