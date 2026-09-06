"use server";

import { requireSuperadmin } from "@/lib/session";
import { ipActivity } from "@/modules/auth/ip-block";

/**
 * O retrato de um IP, buscado quando o admin abre o diálogo de bloqueio.
 *
 * Sob demanda, e não junto da lista: a página traz 50 eventos, e calcular os
 * contadores de cada IP no carregamento seriam 50 agregações em `LoginAttempt`
 * para mostrar números que quase sempre ninguém vai olhar. O clique é raro; a
 * listagem é toda vez.
 */
export type IpSummaryResult =
  | { ok: true; summary: { ip: string; total: number; failures: number; distinctEmails: number; lastEmail: string | null; days: number } }
  | { ok: false; error: string };

export async function ipSummaryFor(ip: string): Promise<IpSummaryResult> {
  await requireSuperadmin();

  if (!ip || ip === "desconhecido") {
    return { ok: false, error: "Este evento não registrou um endereço utilizável." };
  }

  try {
    const activity = await ipActivity(ip);
    return {
      ok: true,
      summary: {
        ip,
        total: activity.total,
        failures: activity.failures,
        distinctEmails: activity.distinctEmails,
        lastEmail: activity.lastEmail,
        days: activity.days,
      },
    };
  } catch (error) {
    console.error("[admin] falha ao resumir o IP", ip, error);
    return { ok: false, error: "Não foi possível carregar o histórico deste IP." };
  }
}
