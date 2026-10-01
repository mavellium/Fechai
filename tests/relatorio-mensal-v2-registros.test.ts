import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/modules/scheduling/clinicorp", () => ({ readClinicorpReport: vi.fn() }));
vi.mock("@/app/(dashboard)/relatorios/EvidenceDialog", () => ({
  EvidenceDialog: ({ children }: { children: import("react").ReactNode }) => createElement("div", null, children),
}));
import { evaluateMonthlyMetrics, type MonthlyReport } from "@/modules/reports/monthly";
import { monthlyV2Evidence } from "@/modules/reports/monthly-v2-evidence";
import { MonthlyReportEvidence } from "@/app/(dashboard)/relatorios/monthly-v2/MonthlyReportEvidence";
import { MonthlyReportDocument } from "@/app/(dashboard)/relatorios/monthly-v2/MonthlyReportDocument";
import { approvedDocument } from "@/modules/reports/monthly-document";
import { v2Input } from "./fixtures/monthly-report-v2";

function report(): MonthlyReport {
  const input = v2Input();
  const { metrics, data, evidence } = evaluateMonthlyMetrics(input);
  return { tenantName: "Clínica", month: "2026-09", label: "setembro de 2026", previousMonth: "2026-08", status: "ready",
    assumptions: input.config, current: metrics, previous: metrics, data, evidence, nextActions: [], agentChanges: [] } as unknown as MonthlyReport;
}

describe("origem dos números do relatório v2", () => {
  it("abre cidade histórica por id/data, só com a população atendida confirmada", () => {
    const r = report();
    r.evidence!.leads = [{ leadId: "lead", conversationId: "c000", createdAt: "2026-08-01T12:00:00Z", city: "Marília", verdict: "out",
      outcome: "lost", lossKey: "sumiu", doubtKey: null, cityMessageId: "historical-message", cityDeclaredAt: "2026-08-01T12:00:00Z" }];
    expect(monthlyV2Evidence(r).find((entry) => entry.key === "withCity")).toBeUndefined();
    r.evidence!.leadPopulation = "attended";
    const entry = monthlyV2Evidence(r).find((entry) => entry.key === "withCity")!;
    expect(entry.rows[0].cells).toContain("historical-message");
    expect(entry.metric).toBe(r.data!.leads.withCity);
    expect(entry.rows[0].cells).toContain("Declaração no histórico");
  });

  it("inclui contato atendido somente pela equipe mesmo quando o legado o exclui", () => {
    const input = v2Input();
    const humanOnly = input.conversations[14];
    humanOnly.messages = humanOnly.messages.filter((m) => m.sentBy !== "agent");
    const { metrics, data, evidence } = evaluateMonthlyMetrics(input);
    const r = { ...report(), current: metrics, data, evidence };
    expect(evidence.conversations.find((c) => c.conversationId === humanOnly.id)?.excluded).toBe("human_only");
    const entries = monthlyV2Evidence(r);
    expect(entries.find((x) => x.key === "contacts")!.rows.some((row) => row.id === humanOnly.id)).toBe(true);
    expect(entries.find((x) => x.key === "transferred")!.rows.some((row) => row.id === humanOnly.id)).toBe(true);
    expect(entries.find((x) => x.key === "agentResponse")!.rows.some((row) => row.id === humanOnly.id)).toBe(false);
  });
  it("explica os contatos do motor v2, incluindo recepção, sem reutilizar o total legado", () => {
    const r = report();
    const entry = (key: string) => monthlyV2Evidence(r).find((x) => x.key === key)!;
    expect(entry("contacts").rows).toHaveLength(214);
    expect(entry("aiOnly").rows).toHaveLength(156);
    expect(entry("transferred").rows).toHaveLength(58);
    expect(entry("receptionAnswered").rows).toHaveLength(55);
    expect(entry("receptionUnanswered").rows).toHaveLength(3);
    expect(entry("receptionWait").rows).toHaveLength(11);
    expect(entry("agentResponse").value).toBe("38 s");
    expect(entry("receptionResponse").value).toBe("22 min");
    expect(entry("notScheduled").rows).toHaveLength(183);
    expect(entry("contacts").rows[0].cells[1]).toContain("06:00");
  });
  it("mantém a coorte, as consultas anteriores e as bases da taxa separadas", () => {
    const entries = monthlyV2Evidence(report());
    const rows = (key: string) => entries.find((x) => x.key === key)!.rows;
    expect(rows("scheduled")).toHaveLength(31);
    expect(rows("attended")).toHaveLength(21);
    expect(rows("no_show")).toHaveLength(6);
    expect(rows("upcoming")).toHaveLength(3);
    expect(rows("unverified")).toHaveLength(1);
    expect(rows("attendanceRate")).toHaveLength(27);
    expect(rows("earlierAttended")).toHaveLength(2);
    expect(rows("scheduled").some((x) => rows("earlierAttended").some((a) => a.id === x.id))).toBe(false);
  });
  it("duração de áudio ausente aparece como não medida e não zero", () => {
    const r = report();
    r.evidence!.messages.find((m) => m.kind === "audio")!.seconds = null;
    const audios = monthlyV2Evidence(r).find((x) => x.key === "audios")!;
    expect(audios.rows[0].cells.at(-1)).toBe("Não medida");
    expect(monthlyV2Evidence(r).find((x) => x.key === "textMessages")!.rows).toHaveLength(910);
  });
  it("usa o valor congelado mesmo quando a lista foi limitada, sem alterar o snapshot", () => {
    const r = report();
    r.evidence!.contacts = r.evidence!.contacts!.slice(0, 2);
    r.evidence!.truncated.contacts = 6000;
    const before = JSON.stringify(r);
    const entry = monthlyV2Evidence(r).find((x) => x.key === "contacts")!;
    expect(entry.value).toBe("214");
    expect(entry.rows).toHaveLength(2);
    expect(entry.truncated).toBe(6000);
    const html = renderToStaticMarkup(createElement(MonthlyReportEvidence, { report: r }));
    expect(html).toContain("6.000");
    expect(html).toContain("podem não somar");
    expect(JSON.stringify(r)).toBe(before);
  });
  it("projeta só campos permitidos, sem nome, telefone ou texto de conversa", () => {
    const r = report();
    Object.assign(r.evidence!.contacts![0], { name: "PACIENTE_SECRETO", phone: "5519999999999", content: "MENSAGEM_PRIVADA" });
    const out = JSON.stringify(monthlyV2Evidence(r));
    for (const secret of ["PACIENTE_SECRETO", "5519999999999", "MENSAGEM_PRIVADA"]) expect(out).not.toContain(secret);
  });
  it("não inventa registros em snapshots antigos e deixa a impressão sem tabelas individuais", () => {
    const r = report();
    expect(monthlyV2Evidence({ ...r, data: undefined })).toEqual([]);
    expect(monthlyV2Evidence({ ...r, evidence: undefined })).toEqual([]);
    const old = { ...r, evidence: { ...r.evidence!, contacts: undefined, cohort: undefined } };
    expect(monthlyV2Evidence(old).some((x) => x.key === "contacts" || x.key === "scheduled")).toBe(false);
    const document = approvedDocument(r);
    expect(monthlyV2Evidence(document)).toEqual([]);
    const pdf = renderToStaticMarkup(createElement(MonthlyReportDocument, { report: document, print: true }));
    expect(pdf).not.toContain("Ver registros");
    expect(pdf).not.toContain("Conversa (ID)");
    expect(pdf).not.toContain(r.evidence!.messages[0].messageId);
  });
});
