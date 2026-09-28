import * as React from "react";
import { Alert } from "@/components/ui/alert";
import type { MonthlyReport } from "@/modules/reports/monthly";

export function MonthlyClinicorpStatus({ report }: {
  report: Pick<MonthlyReport, "clinicorpError" | "clinicorpStatusTypes" | "clinicorpIntegrationState">;
}) {
  const state = report.clinicorpIntegrationState;
  if (report.clinicorpError) {
    const title = state === "not_connected" ? "Clinicorp não conectado"
      : state === "disabled" ? "Clinicorp desabilitado"
      : state === "credentials_error" ? "Credenciais do Clinicorp precisam de revisão"
      : state === "configured" ? "Falha na consulta do Clinicorp" : "Consulta do Clinicorp pendente";
    return <Alert tone={state === "not_connected" || state === "disabled" ? "info" : "warn"} title={title}>
      <p>{report.clinicorpError}</p>
      <p className="mt-2">Comparecimentos vinculados ao Clinicorp ficam pendentes até a conferência. Os demais usam o comparecimento registrado na agenda do Fechai.</p>
    </Alert>;
  }
  if (report.clinicorpStatusTypes.length) return <Alert tone="success" title="Status do Clinicorp carregados">
    Status obtidos da integração desta conta. Selecione apenas os que comprovam comparecimento.
  </Alert>;
  return <Alert title={state === "configured" ? "Consulta do Clinicorp concluída" : "Sem status nesta revisão"}>
    {state === "configured" ? "O Clinicorp respondeu, mas não retornou status para selecionar." : "Importe os dados da conta para consultar os status atuais do Clinicorp."}
  </Alert>;
}
