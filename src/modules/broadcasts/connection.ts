import { prisma } from "@/lib/prisma";
import {
  getWhatsAppProviderForInstance,
  WHATSAPP_PROVIDER_SELECT,
} from "@/modules/whatsapp/meta-config";
import { MetaCloudProvider } from "@/modules/whatsapp/meta";

export async function getBroadcastConnection(tenantId: string) {
  const instance = await prisma.whatsappInstance.findFirst({
    where: {
      tenantId,
      provider: "meta",
      status: "connected",
      tenant: { metaWhatsappEnabled: true, status: "active" },
    },
    select: { ...WHATSAPP_PROVIDER_SELECT, metaDisplayPhone: true },
  });
  if (!instance) return null;
  const provider = getWhatsAppProviderForInstance(instance);
  if (
    !(provider instanceof MetaCloudProvider) ||
    !provider.isConfigured() ||
    !instance.metaBusinessAccountId
  )
    return null;
  return {
    provider,
    phoneNumberId: instance.metaPhoneNumberId ?? instance.externalId!,
    displayPhone: instance.metaDisplayPhone,
  };
}
