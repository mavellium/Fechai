"use server";
import { requireProductAccess } from "@/lib/require-product";
import { requireTenant } from "@/lib/session";
import { prepareConfirmationTest } from "@/modules/scheduling/confirmation-test";
import type { ActionResult } from "@/components/ui/toast/types";

export async function testConfirmationMessage(agentId: string): Promise<ActionResult> {
  await requireProductAccess();
  const { tenantId } = await requireTenant();
  try {
    const result = await prepareConfirmationTest(tenantId, agentId);
    if (!result.ok) return { ok: false, error: result.error, code: "validation" };
    return { ok: true, info: "Mensagem adicionada à conversa de teste deste agente. Nenhum envio por WhatsApp foi feito." };
  } catch { return { ok: false, error: "Não foi possível preparar a mensagem de teste.", code: "server" }; }
}
