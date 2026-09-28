import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { listClinicorpAgenda, type ClinicorpAgenda } from "./clinicorp";
import { parseScheduleConfig } from "./config";
import { clockInZone, monthRangeUtc } from "./time";

/**
 * "A agenda deste mês mudou?" — o que a `/agenda` ao vivo pergunta a cada 15s.
 *
 * Refazer a página inteira a cada volta (o primeiro desenho do ao vivo) segurava
 * a tela: `router.refresh()` entra na fila do roteador, e um clique num dia
 * esperava a releitura do Clinicorp terminar. Agora o cliente pergunta só a
 * versão, fora dessa fila, e refaz a página apenas quando ela mudou.
 *
 * A versão tem que sair **igual** na página e na rota, senão a tela se refaz em
 * loop: as duas passam pelo mesmo `agendaVersion`.
 */

/** Primeiro e último dia do mês, como o Clinicorp recebe (`from`/`to` inclusivos). */
export function monthDays(year: number, month: number): { from: string; to: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(last)}` };
}

/**
 * Impressão digital do que a agenda desenha: compromissos do fechai (quantos e
 * a última alteração — status, horário e exclusão mudam um dos dois) e as
 * consultas do Clinicorp. A ordem das consultas não entra: duas no mesmo
 * horário podem vir trocadas de uma leitura para outra sem nada ter mudado.
 */
export function agendaVersion(
  local: { count: number; lastUpdate: Date | null },
  clinicorp: ClinicorpAgenda,
): string {
  const parts = [`fechai:${local.count}:${local.lastUpdate?.getTime() ?? 0}`, `clinicorp:${clinicorp.status}`];
  if (clinicorp.status === "ok") {
    parts.push(
      `skipped:${clinicorp.skipped}`,
      ...clinicorp.items
        .map((i) =>
          [i.id, i.startsAt.getTime(), i.endsAt?.getTime() ?? "", i.patientName, i.professional ?? "", i.phone ?? "", i.notes ?? ""].join("\u0001"),
        )
        .sort(),
    );
  }
  if (clinicorp.status === "error") parts.push(clinicorp.error);
  return createHash("sha1").update(parts.join("\u0002")).digest("hex").slice(0, 16);
}

/** Fuso da agenda: o do agente principal, mesma escolha da página. */
async function agendaTimezone(tenantId: string): Promise<string> {
  const agent = await prisma.agent.findFirst({
    where: { tenantId, archived: false },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    select: { actions: { where: { key: "schedule_meeting" }, select: { config: true } } },
  });
  return parseScheduleConfig(agent?.actions[0]?.config).timezone;
}

/**
 * A versão atual do mês, com o Clinicorp relido de verdade (`fresh`). Essa
 * leitura reabastece o cache, então a página refeita logo depois já nasce com
 * ela, sem outra chamada.
 */
export async function readAgendaPulse(
  tenantId: string,
  year: number,
  month: number,
): Promise<{ version: string; checkedAt: string }> {
  const timezone = await agendaTimezone(tenantId);
  const { start, end } = monthRangeUtc(year, month, timezone);
  const { from, to } = monthDays(year, month);
  const [local, clinicorp] = await Promise.all([
    // Mesmo filtro de `listMonthAppointments`.
    prisma.appointment.aggregate({
      where: { tenantId, startsAt: { gte: start, lt: end } },
      _count: { _all: true },
      _max: { updatedAt: true },
    }),
    listClinicorpAgenda(tenantId, from, to, timezone, { fresh: true }),
  ]);
  return {
    version: agendaVersion({ count: local._count._all, lastUpdate: local._max.updatedAt }, clinicorp),
    checkedAt: clockInZone(new Date(), timezone),
  };
}
