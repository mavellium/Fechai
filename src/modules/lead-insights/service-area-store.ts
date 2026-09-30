import { prisma } from "@/lib/prisma";
import { parseServiceArea, serviceAreaFormSchema, type ServiceArea } from "./service-area";

/** Área de atendimento do tenant, ou `null` se não foi configurada (ou está ilegível). Nunca lança. */
export async function getServiceArea(tenantId: string): Promise<ServiceArea | null> {
  try {
    const row = await prisma.tenantServiceArea.findUnique({ where: { tenantId }, select: { baseCity: true, cities: true } });
    return parseServiceArea(row);
  } catch (error) {
    console.error("[lead-insights] área de atendimento indisponível", error);
    return null;
  }
}

export type SaveServiceAreaResult = { ok: true; area: ServiceArea } | { ok: false; error: string };

/** Valida o formulário e grava. Quem chama já checou sessão e tenant. */
export async function saveServiceArea(tenantId: string, form: { baseCity: unknown; cities: unknown }): Promise<SaveServiceAreaResult> {
  const parsed = serviceAreaFormSchema.safeParse({ baseCity: form.baseCity ?? "", cities: form.cities ?? "" });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const { baseCity, cities } = parsed.data;
  await prisma.tenantServiceArea.upsert({
    where: { tenantId },
    create: { tenantId, baseCity, cities },
    update: { baseCity, cities },
  });
  return { ok: true, area: { baseCity, cities } };
}
