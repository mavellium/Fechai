"use server";

import { z } from "zod";
import { requireTenant } from "@/lib/session";
import { createFeedback } from "@/modules/feedback/service";

const schema = z.object({
  message: z.string().trim().min(3, "Escreva um pouco mais"),
  rating: z.coerce.number().int().min(1).max(5).optional(),
});

type Result = { ok: boolean; error?: string; info?: string };

export async function submitFeedback(_prev: Result | null, formData: FormData): Promise<Result> {
  const { tenantId } = await requireTenant();
  const raw = {
    message: formData.get("message"),
    rating: formData.get("rating") || undefined,
  };
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }
  await createFeedback(tenantId, parsed.data.message, parsed.data.rating ?? null);
  return { ok: true, info: "Obrigado pelo feedback!" };
}
