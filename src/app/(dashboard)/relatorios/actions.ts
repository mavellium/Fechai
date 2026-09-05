"use server";

import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { payloadTooLarge } from "@/lib/rate-limit";

type Result = { ok: boolean; error?: string; info?: string };

const MAX_CENTS = 1_000_000_000; // R$ 10 milhões de teto de sanidade

/** "500", "499,90" ou "1.234,56" → centavos (aceita pontos de milhar e vírgula). */
function parseReais(raw: string): number | null {
  const digits = raw.replace(/[^\d.,]/g, "").replace(/\.(?=\d{3}([.,]|$))/g, "").replace(",", ".");
  const value = Number(digits);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

/**
 * Define (ou altera) o valor de um lead fechado na visão Financeira de
 * /relatorios. Cada salvamento cria uma entrada nova com vigência a partir de
 * agora: janelas que JÁ começaram continuam usando o valor que estava em vigor
 * no início delas, então mudar o número não recalcula períodos passados.
 */
export async function saveLeadValue(_prev: Result | null, formData: FormData): Promise<Result> {
  const tooLarge = payloadTooLarge(formData);
  if (tooLarge) return { ok: false, error: tooLarge };

  const { tenantId } = await requireTenant();

  const cents = parseReais(String(formData.get("value") ?? ""));
  if (!cents) {
    return { ok: false, error: "Informe um valor válido, ex.: 500 ou 499,90." };
  }
  if (cents > MAX_CENTS) {
    return { ok: false, error: "Valor muito alto (máx. R$ 10 milhões)." };
  }

  await prisma.tenantLeadValue.create({
    data: { tenantId, valueCents: cents, startsAt: new Date() },
  });

  revalidatePath("/relatorios");
  return { ok: true, info: "Valor por lead salvo — períodos já iniciados mantêm o valor anterior." };
}
