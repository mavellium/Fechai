/** Teste manual autorizado: cancela SOMENTE a consulta sintética já existente. */
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { cancelAppointment, getScheduleConfig, listMonthAppointments } from "@/modules/scheduling/repository";
import { listClinicorpAgenda, readClinicorpReport } from "@/modules/scheduling/clinicorp";
import { dayKeyInZone, partsInZone } from "@/modules/scheduling/time";

const tenantId = "cmtu5iycd005wnl0kqciz6w6j";
const agentId = "cmtu5iyd6005znl0khctc3n3y";
const title = "Teste Integração Fechai";

// Observa somente os campos do registro sintético. A consulta continua passando
// por readClinicorpReport/getIntegration, com credenciais decifradas pelo módulo.
// Status de comparecimento incompleto não impede conferir Canceled/Deleted.
async function externalState(id: string, day: string) {
  const original = globalThis.fetch;
  let state: { canceled: boolean; deleted: boolean; observation: boolean } | null = null;
  let agendaHttp: number | null = null;
  globalThis.fetch = async (...args: Parameters<typeof fetch>): Promise<Response> => {
    const response = await original(...args);
    const input = args[0];
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === "api.clinicorp.com" && url.pathname.endsWith("/appointment/list")) {
      agendaHttp = response.status;
      if (response.ok) {
        const body: unknown = await response.clone().json().catch(() => null);
        if (Array.isArray(body)) {
          const row = body.find(r => r && typeof r === "object" && String(r.id) === id);
          if (row) state = { canceled: row.Canceled === "X", deleted: row.Deleted === "X",
            observation: typeof row.Notes === "string" && row.Notes.includes("Cancelado em") };
        }
      }
    }
    return response;
  };
  try {
    const report = await readClinicorpReport(tenantId, day, day);
    console.log(JSON.stringify({ diagnostic: { agendaHttp, reportAvailable: report.available,
      reportError: report.error, syntheticRecordFound: Boolean(state) } }));
    return state as { canceled: boolean; deleted: boolean; observation: boolean } | null;
  } finally { globalThis.fetch = original; }
}

async function main() {
  assert.equal(process.env.FECHAI_CANCEL_SMOKE, "CONFIRMAR_TESTE_SINTETICO", "Confirmação explícita do teste ausente");
  const tenant = await prisma.tenant.findFirst({ where: { id: tenantId, status: "active" }, select: { id: true } });
  assert.ok(tenant, "Conta de teste esperada indisponível");
  const rows = await prisma.appointment.findMany({
    where: { tenantId, agentId, title, lead: { isTest: true, phone: `sandbox:${agentId}` },
      startsAt: { gte: new Date("2026-10-08T00:00:00Z"), lt: new Date("2026-10-09T00:00:00Z") } },
    include: { lead: { select: { isTest: true, phone: true } } }, take: 2,
  });
  assert.equal(rows.length, 1, "Consulta sintética ausente ou ambígua; nenhuma consulta alterada");
  const before = rows[0];
  assert.equal(before.lead?.isTest, true, "Consulta não é de teste");
  assert.ok(before.clinicorpAppointmentId, "Consulta de teste não está vinculada ao Clinicorp");
  assert.ok(["scheduled", "canceled"].includes(before.status), "Estado da consulta não permite o teste");
  const cfg = await getScheduleConfig(agentId);
  const timezone = cfg?.timezone ?? "America/Sao_Paulo";
  const day = dayKeyInZone(before.startsAt, timezone);
  const prior = await externalState(before.clinicorpAppointmentId, day);
  assert.ok(prior, "Consulta externa não localizada; nenhuma alteração feita");
  // O espelho pode já estar cancelado: o teste continua conferindo a observação
  // e a preservação LOCAL, sem afirmar uma transição externa que não ocorreu.

  const canceled = await cancelAppointment(tenantId, before.id, before.leadId ?? undefined, {
    timezone, source: "human", reason: "Teste autorizado de cancelamento; consulta sintética, sem paciente real.",
  });
  assert.ok(canceled, "Cancelamento local não concluído");
  const after = await prisma.appointment.findFirst({ where: { tenantId, id: before.id } });
  assert.ok(after, "Consulta local não foi preservada");
  assert.equal(after.status, "canceled", "Consulta local não ficou cancelada");
  assert.equal(after.startsAt.getTime(), before.startsAt.getTime(), "Horário original foi alterado");
  assert.equal(after.endsAt.getTime(), before.endsAt.getTime(), "Duração original foi alterada");
  assert.equal(after.clinicorpAppointmentId, before.clinicorpAppointmentId, "Vínculo externo foi alterado");
  assert.ok(after.notes?.includes("Cancelado em"), "Observação de cancelamento ausente");
  if (before.status === "scheduled" && before.notes) assert.ok(after.notes?.startsWith(before.notes), "Observação anterior não foi preservada");
  const date = partsInZone(after.startsAt, timezone);
  const month = await listMonthAppointments(tenantId, date.year, date.month, timezone);
  assert.ok(month.rows.some(a => a.id === after.id && a.status === "canceled"), "Consulta cancelada não aparece na leitura da agenda");
  const stillBusy = await prisma.appointment.count({ where: { id: after.id, tenantId, status: "scheduled" } });
  assert.equal(stillBusy, 0, "Consulta cancelada ainda ocupa vaga local");
  const repeated = await cancelAppointment(tenantId, after.id, before.leadId ?? undefined, { timezone });
  assert.equal(repeated?.notes, after.notes, "Repetição duplicou ou alterou observações");
  const external = await externalState(after.clinicorpAppointmentId, day);
  assert.ok(external, "Registro externo não localizado mesmo incluindo cancelados/excluídos");
  const agenda = await listClinicorpAgenda(tenantId, day, day, timezone, { fresh: true });
  assert.equal(agenda.status, "ok", "Leitura de agenda externa indisponível");
  const visibleExternal = agenda.status === "ok" ? agenda.items.find(a => a.id === after.clinicorpAppointmentId) : undefined;
  console.log(JSON.stringify({
    local: { preserved: true, canceled: true, observation: true, priorNotesPreserved: true,
      originalTimePreserved: true, visibleInAgendaQuery: true, occupiesLocalSlot: false, repeatedWithoutDuplicate: true },
    clinicorp: { before: prior, idPreserved: true, canceled: external.canceled, deleted: external.deleted, visibleInCanceledAgendaRead: Boolean(visibleExternal),
      canceledInAgendaRead: visibleExternal?.canceled ?? null, observationWrittenInClinicorp: external.observation },
    limitations: ["Observação gravada no Fechai; API pública não oferece atualização de observações existentes no Clinicorp.",
      "Leitura da API não comprova visibilidade na grade nativa do Clinicorp.",
      "Teste executado no servidor, sem validação visual nem conversa com LLM.",
      ...(prior.canceled || prior.deleted ? ["Registro externo já estava cancelado/excluído antes do teste; transição externa não foi validada."] : [])],
  }));
  assert.ok(external.canceled || external.deleted, "Clinicorp não confirmou cancelamento ou exclusão do registro de teste");
}
main().catch((error: unknown) => {
  if (error instanceof Error && error.name === "AssertionError") console.error(error.message.split("\n")[0]);
  console.error("Teste de cancelamento não concluiu todos os critérios. Consulte os resultados seguros acima; nenhuma consulta real é alvo deste script.");
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
