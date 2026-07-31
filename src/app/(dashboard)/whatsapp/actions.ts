"use server";

import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getWhatsAppProvider } from "@/modules/whatsapp";

type ConnectResult = {
  ok: boolean;
  status?: string;
  qrCode?: string;
  error?: string;
};

export async function connectWhatsapp(): Promise<ConnectResult> {
  const { tenantId } = await requireTenant();
  const provider = getWhatsAppProvider();

  if (!provider.isConfigured()) {
    return { ok: false, error: "Evolution API não configurada (EVOLUTION_API_URL / EVOLUTION_API_KEY)." };
  }

  try {
    const existing = await prisma.whatsappInstance.findUnique({ where: { tenantId } });
    // Instância já criada: só atualiza o QR. Recriar com o mesmo nome devolve
    // 403 da Evolution (instância em uso) e quebrava a tela na 2ª visita.
    const res = existing?.externalId
      ? { externalId: existing.externalId, ...(await provider.getQrCode(existing.externalId)) }
      : await provider.createInstance(tenantId);
    await prisma.whatsappInstance.upsert({
      where: { tenantId },
      create: { tenantId, externalId: res.externalId, status: res.status },
      update: { externalId: res.externalId, status: res.status },
    });
    revalidatePath("/whatsapp");
    revalidatePath("/inicio");
    return { ok: true, status: res.status, qrCode: res.qrCode };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Falha ao conectar" };
  }
}

export async function refreshWhatsappStatus(): Promise<ConnectResult> {
  const { tenantId } = await requireTenant();
  const provider = getWhatsAppProvider();
  const instance = await prisma.whatsappInstance.findUnique({ where: { tenantId } });
  if (!instance?.externalId) return { ok: false, error: "Nenhuma instância criada ainda." };
  if (!provider.isConfigured()) return { ok: false, error: "Evolution API não configurada." };

  try {
    const res = await provider.getQrCode(instance.externalId);
    await prisma.whatsappInstance.update({ where: { tenantId }, data: { status: res.status } });
    revalidatePath("/whatsapp");
    revalidatePath("/inicio");
    return { ok: true, status: res.status, qrCode: res.qrCode };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Falha ao atualizar" };
  }
}
