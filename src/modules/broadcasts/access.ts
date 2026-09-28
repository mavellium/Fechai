import { notFound } from "next/navigation";
import { requireProductAccess } from "@/lib/require-product";
import { prisma } from "@/lib/prisma";

/** Repete o guarda em toda action: layout e menu não autorizam uma mutação. */
export async function requireBroadcastAccess() {
  return (await requireBroadcastActor()).tenantId;
}

export async function requireBroadcastActor() {
  const { session } = await requireProductAccess();
  const tenant = await prisma.tenant.findUnique({
    where: { id: session.user.tenantId },
    select: { id: true, status: true, metaWhatsappEnabled: true },
  });
  if (!tenant?.metaWhatsappEnabled || tenant.status !== "active") notFound();
  return {
    tenantId: tenant.id,
    userId: session.user.id,
    label: session.user.email ?? session.user.name ?? session.user.id,
  };
}
