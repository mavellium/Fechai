import Link from "next/link";
import { Users } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Card, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Stat } from "@/components/ui/stat";
import { HorizontalBars } from "@/components/charts/HorizontalBars";
import { SUGGESTION_DISCLAIMER, leadQualityHeadline, type LeadQuality, type RankItem } from "@/modules/lead-insights/summary";

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "—");

const OUTCOME_ROWS: [keyof LeadQuality["outcomes"], string][] = [
  ["scheduled", "Agendou"], ["handoff", "Transbordou para a equipe"], ["lost", "Perdeu"], ["open", "Em andamento"],
];

const rankPoints = (items: RankItem[], total: number) =>
  items.map((i) => ({ key: i.key, label: i.label, value: i.count, secondaryLabel: pct(i.count, total) }));

/**
 * Qualidade dos leads: quanto da verba de tráfego comprou lead que não converte
 * e por quê. Só agregados — nenhum nome, telefone ou texto de conversa. Usada
 * no painel (`?visao=leads`) e reaproveitada, sem cabeçalho de período, pelo
 * relatório mensal.
 */
export function LeadQualityView({ quality: q, period }: { quality: LeadQuality; period: string }) {
  if (q.leads === 0) {
    return (
      <Card>
        <EmptyState
          icon={Users}
          title="Ainda não há leads neste período"
          description="Assim que chegarem contatos novos, aqui aparece de onde eles são, o que perguntam e por que não fecham."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {!q.areaConfigured && (
        <Alert tone="warn" title="Configure a área de atendimento">
          Sem ela não dá para separar quem é de dentro e de fora do raio.{" "}
          <Link href="/configuracoes" className="underline underline-offset-2">Configurar em Configurações</Link>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Leads no período" value={String(q.leads)} hint={period} />
        <Stat label="Informaram a cidade" value={String(q.withCity)} hint={`${pct(q.withCity, q.leads)} dos leads`}
          about="O agente registra a cidade quando o contato diz de onde é. Quem não disse fica de fora das contas de raio." />
        <Stat label="Fora do raio" value={q.areaConfigured ? pct(q.outOfRadius, q.withCity) : "—"}
          hint={q.areaConfigured ? `${q.outOfRadius} de ${q.withCity} que informaram` : "área não configurada"} />
        <Stat label="Agendaram" value={q.areaConfigured ? `${q.inScheduled} / ${q.outScheduled}` : String(q.outcomes.scheduled)}
          hint={q.areaConfigured ? "dentro / fora do raio" : "no total"} />
      </div>

      <p className="max-w-prose text-base leading-relaxed text-ink panel:text-white/85">{leadQualityHeadline(q)}</p>
      {q.lowSample && q.withCity > 0 && (
        <p className="text-sm text-neutral panel:text-white/55">Poucos leads informaram a cidade ({q.withCity}); as sugestões de tráfego só aparecem com pelo menos 10.</p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle hint="As cidades que mais apareceram entre quem informou.">Cidades dos leads</CardTitle>
          <HorizontalBars
            empty="Nenhum lead informou a cidade neste período."
            points={q.cities.map((c) => ({
              key: c.city, label: c.city, value: c.count,
              secondaryLabel: c.verdict === "out" ? "fora do raio" : c.verdict === "in" ? "dentro" : undefined,
            }))}
          />
        </Card>
        <Card>
          <CardTitle hint="A primeira pergunta de verdade, depois da mensagem padrão do anúncio.">Primeiras dúvidas</CardTitle>
          <HorizontalBars empty="Nenhuma dúvida registrada neste período." points={rankPoints(q.doubts, q.withDoubt)} />
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle hint="Só leads que já perderam: motivo dito pelo contato, triagem ou 72 horas sem resposta.">Motivos de perda</CardTitle>
          <HorizontalBars empty="Nenhum lead perdido neste período." colorClass="bg-warn" points={rankPoints(q.losses, q.lostTotal)} />
        </Card>
        <Card>
          <CardTitle>O que aconteceu com os leads</CardTitle>
          <DataTable caption="Resultado dos leads no período" head={["Resultado", "Leads", "Parte"]}
            rows={OUTCOME_ROWS.map(([key, label]) => ({ id: key, cells: [label, String(q.outcomes[key]), pct(q.outcomes[key], q.leads)] }))} />
        </Card>
      </div>

      {q.suggestions.length > 0 && (
        <Card>
          <CardTitle>Melhorias sugeridas para o tráfego</CardTitle>
          <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-ink panel:text-white/85">
            {q.suggestions.map((s) => <li key={s}>{s}</li>)}
          </ul>
          <p className="mt-4 text-xs leading-relaxed text-neutral panel:text-white/55">{SUGGESTION_DISCLAIMER}</p>
        </Card>
      )}

      <p className="text-xs leading-relaxed text-neutral panel:text-white/55">
        Conta os leads reais criados no período. A cidade, a dúvida e o motivo são o que o agente registrou do que o contato disse — nunca deduzidos. Dentro ou fora do raio usa a área de atendimento de hoje. Perdeu = motivo registrado, triagem, follow-up de quem recusou ou 72 horas sem resposta; antes disso o lead conta como em andamento.
      </p>
    </div>
  );
}
