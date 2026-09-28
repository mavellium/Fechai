import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MonthlyClinicorpStatus } from "@/app/(admin)/admin/relatorios/[tenantId]/MonthlyClinicorpStatus";
import type { MonthlyReport } from "@/modules/reports/monthly";

type Status = Pick<MonthlyReport, "clinicorpError" | "clinicorpStatusTypes" | "clinicorpIntegrationState">;
const render = (report: Status) => renderToStaticMarkup(createElement(MonthlyClinicorpStatus, { report }));
describe("aviso do Clinicorp na revisão mensal", () => {
  it("mostra o erro da consulta mesmo quando existem status recebidos", () => {
    const html = render({ clinicorpIntegrationState: "configured", clinicorpError: "Agenda recusou acesso (HTTP 403).", clinicorpStatusTypes: [{ type: "DONE", description: "Realizado" }] });
    expect(html).toContain("Falha na consulta do Clinicorp"); expect(html).toContain("HTTP 403"); expect(html).not.toContain("Clinicorp não conectado");
    expect(html).toContain("Comparecimentos vinculados ao Clinicorp ficam pendentes");
  });
  it("distingue resposta vazia de ausência de conexão", () => {
    expect(render({ clinicorpIntegrationState: "configured", clinicorpError: null, clinicorpStatusTypes: [] })).toContain("O Clinicorp respondeu");
    expect(render({ clinicorpIntegrationState: "not_connected", clinicorpError: "Configure a integração.", clinicorpStatusTypes: [] })).toContain("Clinicorp não conectado");
  });
  it("substitui o aviso de falha pelo estado atualizado de sucesso", () => {
    const html = render({ clinicorpIntegrationState: "configured", clinicorpError: null, clinicorpStatusTypes: [{ type: "DONE", description: "Realizado" }] });
    expect(html).toContain("Status do Clinicorp carregados"); expect(html).not.toContain("Falha na consulta");
  });
  it("não deduz desconexão de um snapshot antigo sem metadados", () => {
    expect(render({ clinicorpError: null, clinicorpStatusTypes: [] })).toContain("Sem status nesta revisão");
  });
});
