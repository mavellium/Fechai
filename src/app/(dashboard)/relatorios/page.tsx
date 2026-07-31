import { BarChart3 } from "lucide-react";
import { requireTenant } from "@/lib/session";
import { computeTenantReport } from "@/modules/reports/service";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";

export default async function RelatoriosPage() {
  const { tenantId } = await requireTenant();
  const r = await computeTenantReport(tenantId);

  // Sem nenhuma conversa, a grade de sete zeros não informa nada e ainda dá a
  // impressão de que o relatório quebrou. Estado vazio com o próximo passo.
  const empty = r.conversations === 0 && r.leads === 0;

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <PageHeader
        eyebrow="relatórios"
        title="Números da sua conta"
        description="Tudo desde o início da conta, atualizado a cada carregamento."
      />

      {empty ? (
        <Card>
          <EmptyState
            icon={BarChart3}
            title="Ainda não há o que medir"
            description="Os números aparecem assim que seu agente tiver a primeira conversa. Conecte o WhatsApp ou faça um teste no sandbox para começar."
            action={<ButtonLink href="/conversas">Testar no sandbox</ButtonLink>}
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Stat label="Conversas" value={String(r.conversations)} />
          <Stat label="Leads capturados" value={String(r.leads)} />
          <Stat label="Leads quentes" value={String(r.hotLeads)} />
          <Stat label="Agendamentos" value={String(r.scheduled)} />
          <Stat label="Precisam de humano" value={String(r.needsHuman)} />
          <Stat label="Follow-ups enviados" value={String(r.followUpsSent)} />
          <Stat
            label="Taxa de resposta"
            value={`${Math.round(r.responseRate * 100)}%`}
            hint="Conversas em que o lead respondeu 2+ vezes"
          />
        </div>
      )}
    </div>
  );
}
