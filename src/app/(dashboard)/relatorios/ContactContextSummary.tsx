import type { ContactContextSummary as Summary } from "@/modules/reports/contact-context";
import { formatCount, formatPercent } from "@/modules/reports/monthly-format";
import { Card, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";

export function ContactContextSummary({ summary }: { summary: Summary }) {
  return <Card>
    <CardTitle hint="Cada contato aparece uma vez, pelo início da atividade no período. A taxa usa os contatos e as avaliações do mesmo grupo.">Quem iniciou e o que virou agendamento</CardTitle>
    <DataTable caption="Conversão por contexto" head={["Contexto", "Contatos", "Atendidos", "Contatos que agendaram", "Conversão"]}
      headerAlign="left" columnAlign={["left", "right", "right", "right", "right"]}
      rows={summary.groups.filter((g) => g.contacts > 0).map((g) => ({ id: g.key, cells: [g.label, formatCount(g.contacts), formatCount(g.attended),
        formatCount(g.scheduledContacts), formatPercent(g.conversionPercent)] }))} />
    <p className="mt-3 text-sm text-neutral panel:text-white/60">Contatos incluem quem não respondeu ou não recebeu resposta. Agendaram conta pessoas, uma vez por grupo, com avaliação criada pelo agente após a entrada do contato. Lembretes e abordagens não são novas entradas.</p>
    <p className="mt-2 text-sm text-neutral panel:text-white/60">Origem de aquisição não registrada: entrada espontânea não comprova anúncio; contato antigo não comprova base qualificada. Finalidade das abordagens da equipe depende de registro, sem inferência pelo texto.</p>
    {summary.unattributedEvaluations > 0 && <p className="mt-2 text-sm text-neutral panel:text-white/60">{formatCount(summary.unattributedEvaluations)} avaliações sem vínculo com uma entrada anterior nesta janela ficam fora destas taxas.</p>}
  </Card>;
}
