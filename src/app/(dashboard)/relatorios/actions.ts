"use server";

import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { payloadTooLarge } from "@/lib/rate-limit";
import {
  MAX_HOURLY_COST_CENTS,
  MAX_MINUTES_PER_LEAD,
} from "@/modules/agent-engine/disqualify";

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

/**
 * Define (ou altera) o custo de um atendimento manual — a base da métrica de
 * triagem ("quanto o agente economizou filtrando quem não era cliente").
 *
 * Mesma vigência de `saveLeadValue`, pelo mesmo motivo: mudar o custo hoje não
 * reescreve o que já foi relatado. São dois campos num salvamento só porque
 * minutos e valor da hora só significam alguma coisa juntos — guardar um sem o
 * outro deixaria uma linha que não converte em dinheiro.
 */
export async function saveAttendanceCost(
  _prev: Result | null,
  formData: FormData,
): Promise<Result> {
  const tooLarge = payloadTooLarge(formData);
  if (tooLarge) return { ok: false, error: tooLarge };

  const { tenantId } = await requireTenant();

  const minutes = Number(String(formData.get("minutes") ?? "").replace(/[^\d]/g, ""));
  const hourly = parseReais(String(formData.get("hourly") ?? ""));

  if (!Number.isInteger(minutes) || minutes <= 0) {
    return { ok: false, error: "Informe os minutos por atendimento, ex.: 8." };
  }
  if (minutes > MAX_MINUTES_PER_LEAD) {
    return { ok: false, error: `No máximo ${MAX_MINUTES_PER_LEAD} minutos por atendimento.` };
  }
  if (!hourly) {
    return { ok: false, error: "Informe o custo da hora, ex.: 30 ou 29,90." };
  }
  if (hourly > MAX_HOURLY_COST_CENTS) {
    return { ok: false, error: "Custo da hora muito alto (máx. R$ 100 mil)." };
  }

  await prisma.tenantAttendanceCost.create({
    data: { tenantId, minutesPerLead: minutes, hourlyCostCents: hourly, startsAt: new Date() },
  });

  revalidatePath("/relatorios");
  return { ok: true, info: "Custo salvo — períodos já iniciados mantêm o custo anterior." };
}
