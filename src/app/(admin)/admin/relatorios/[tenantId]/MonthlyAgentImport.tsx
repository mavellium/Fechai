"use client";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { formatBRL } from "@/lib/format";
import type { MonthlyImportSources } from "@/modules/reports/monthly-import";

export function MonthlyAgentImport({ sources, agentIds, onChange, onImport, pending }: {
  sources: MonthlyImportSources; agentIds: string[]; onChange: (ids: string[]) => void;
  onImport: () => void; pending: boolean;
}) {
  const all = agentIds.length === 0;
  return <section className="space-y-4">
    <CardTitle as="h3" hint="Selecione um ou mais agentes deste cliente. Os indicadores do mês e do comparativo seguem a mesma seleção.">Importar dados da conta e dos agentes</CardTitle>
    <p className="text-sm text-neutral panel:text-white/60">{sources.priceLabel}: {formatBRL(sources.priceCents)} por mês. O valor cadastrado na revisão tem prioridade; confira a mensalidade desta competência.</p>
    {sources.agents.length ? <>
      <div className="flex items-center gap-3"><Switch label="Todos os agentes deste cliente" checked={all} disabled={pending} onCheckedChange={(checked) => onChange(checked ? [] : [sources.agents[0].id])} /><span className="text-sm">Todos os agentes deste cliente</span></div>
      <div className="grid gap-3 sm:grid-cols-2">{sources.agents.map((agent) => {
        const checked = all || agentIds.includes(agent.id);
        return <div key={agent.id} className="flex items-center gap-3 rounded-control border border-ink/10 p-3 panel:border-white/10">
          <Switch label={`Incluir agente ${agent.name}`} checked={checked} disabled={pending || (checked && (all ? sources.agents.length === 1 : agentIds.length === 1))}
            onCheckedChange={(include) => onChange(include ? [...agentIds, agent.id] : (all ? sources.agents.map((a) => a.id) : agentIds).filter((id) => id !== agent.id))} />
          <div><p className="text-sm font-medium">{agent.name}{agent.isPrimary ? " · principal" : ""}{agent.archived ? " · arquivado" : ""}</p><p className="mt-1 text-xs text-neutral panel:text-white/55">{agent.schedule ? "Horários cadastrados disponíveis para importar" : "Sem grade de horários cadastrada"}</p></div>
        </div>;
      })}</div>
    </> : <p className="text-sm text-neutral panel:text-white/55">Nenhum agente cadastrado. Os dados históricos da conta continuam disponíveis.</p>}
    <input type="hidden" name="agentIds" value={JSON.stringify(agentIds)} />
    <Button type="button" size="sm" variant="outline" loading={pending} onClick={onImport}><Download size={14} aria-hidden />Importar dados selecionados</Button>
    <p className="text-xs text-neutral panel:text-white/55">A importação carrega os indicadores e sugere o expediente a partir da agenda dos agentes. Confira os horários da equipe humana e salve a revisão. Ajustes manuais são mantidos.</p>
  </section>;
}
