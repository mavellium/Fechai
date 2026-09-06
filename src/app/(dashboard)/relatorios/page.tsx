import { BarChart3, Download } from "lucide-react";
import { requireTenant, requireOwner } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import {
  computeFinancialSummary,
  computePeriodReport,
  resolveRange,
  type PeriodKey,
} from "@/modules/reports/service";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FadeIn } from "@/components/ui/FadeIn";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { getAffiliateByUser, approveMaturedCommissions } from "@/modules/affiliates/service";
import { getAccountRoles, isAffiliateOnly } from "@/modules/affiliates/roles";
import { getAffiliateOverview } from "@/modules/affiliates/stats";
import { AfiliadoView } from "./AfiliadoView";
import { ChartPanel } from "./ChartPanel";
import { FinancialView } from "./FinancialView";
import { RangePicker } from "./RangePicker";
import { StatusBreakdown } from "./StatusBreakdown";

const PERIODS: PeriodKey[] = ["hoje", "7", "30", "mes", "ano", "tudo"];
// A aba "Afiliados" só existe para quem está no programa — o filtro abaixo
// remove a opção de quem não é afiliado, e a página cai na visão padrão se
// alguém digitar ?visao=afiliados na URL sem ter cadastro.
const VIEWS = ["operacional", "financeiro", "afiliados"] as const;
type View = (typeof VIEWS)[number];

export default async function RelatoriosPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string; de?: string; ate?: string; visao?: string }>;
}) {
  const { tenantId } = await requireTenant();
  const session = await requireOwner();
  const { periodo, de, ate, visao } = await searchParams;
  const period = (PERIODS as string[]).includes(periodo ?? "") ? (periodo as PeriodKey) : "30";

  // O afiliado é do USUÁRIO, não do tenant: a mesma pessoa pode ser cliente e
  // afiliada, e é o login dela que define quais abas existem.
  const [affiliate, roles] = await Promise.all([
    getAffiliateByUser(session.user.id),
    getAccountRoles(session.user.id),
  ]);
  const affiliateOnly = isAffiliateOnly(roles);

  // Quem só afilia tem uma aba só — as outras medem o agente, que essa conta
  // não usa. É também o padrão ao abrir /relatorios sem `?visao=`.
  const requested = (VIEWS as readonly string[]).includes(visao ?? "")
    ? (visao as View)
    : affiliateOnly
      ? "afiliados"
      : "operacional";
  const view: View = affiliateOnly
    ? "afiliados"
    : requested === "afiliados" && !affiliate
      ? "operacional"
      : requested;

  const range = resolveRange(period, de, ate);

  if (view === "afiliados" && affiliate) {
    // Amadurece as comissões antes de somar, para o card bater com o painel.
    await approveMaturedCommissions(affiliate.id);
  }

  const [hasAnyData, report, financial, affiliateOverview] = await Promise.all([
    affiliateOnly ? 1 : prisma.lead.count({ where: { tenantId, isTest: false } }),
    view === "operacional" ? computePeriodReport(tenantId, range) : null,
    view === "financeiro" ? computeFinancialSummary(tenantId, range) : null,
    view === "afiliados" && affiliate ? getAffiliateOverview(affiliate.id) : null,
  ]);

  // Conta sem nenhuma conversa: a grade de zeros não informa nada e ainda dá a
  // impressão de que o relatório quebrou. Estado vazio com o próximo passo.
  //
  // A aba de afiliados escapa dessa saída de propósito: os ganhos não dependem
  // de a conta ter conversas — um afiliado que nunca usou o agente ainda
  // precisa ver o que indicou.
  if (hasAnyData === 0 && view !== "afiliados") {
    return (
      <div className="mx-auto w-full max-w-[1600px] space-y-8">
        <PageHeader
          eyebrow="relatórios"
          title="Números da sua conta"
          description="Gráficos e indicadores aparecem assim que seu agente tiver a primeira conversa."
        />
        <Card>
          <EmptyState
            icon={BarChart3}
            title="Ainda não há o que medir"
            description="Conecte o WhatsApp ou faça um teste no sandbox para começar — os números passam a aparecer aqui a cada carregamento."
            action={<ButtonLink href="/conversas">Testar no sandbox</ButtonLink>}
          />
        </Card>
      </div>
    );
  }

  const prev = report?.kpis.prev ?? null;

  const viewHref = (key: string) => {
    const qs = new URLSearchParams();
    if (de) qs.set("de", de);
    if (ate) qs.set("ate", ate);
    if (!de) qs.set("periodo", period);
    qs.set("visao", key);
    return `/relatorios?${qs.toString()}`;
  };

  const exportQs = new URLSearchParams();
  if (de) exportQs.set("de", de);
  if (ate) exportQs.set("ate", ate);
  if (!de) exportQs.set("periodo", period);

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6">
      <PageHeader
        eyebrow="relatórios"
        title="Números da sua conta"
        description={
          view === "afiliados"
            ? "Seus ganhos como afiliado, mês a mês."
            : view === "financeiro"
              ? `Retorno estimado do investimento no projeto — ${range.label}.`
              : `Acompanhe a evolução da conta — ${range.label}.`
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Uma visão só (conta de afiliado puro) não precisa de seletor. */}
          {!affiliateOnly && (
            <FilterTabs
              label="Visão dos relatórios"
              options={[
                { key: "operacional", label: "Operacional" },
                { key: "financeiro", label: "Financeiro" },
                ...(affiliate ? [{ key: "afiliados", label: "Afiliados" }] : []),
              ]}
              active={view}
              href={viewHref}
            />
          )}
          {/* A série de afiliados é sempre mensal (competência da comissão),
              então um seletor de período aqui prometeria um recorte que o
              gráfico não faz. */}
          {view !== "afiliados" && (
            <RangePicker active={de ? "custom" : period} de={de} ate={ate} visao={view} />
          )}
        </div>
        {view === "operacional" && (
          <ButtonLink href={`/relatorios/export?${exportQs.toString()}`} variant="outline" size="sm">
            <Download size={14} aria-hidden />
            Exportar CSV
          </ButtonLink>
        )}
      </div>

      {view === "operacional" && report ? (
        <>
          <FadeIn>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
              <Stat
                label="Conversas ativas"
                value={String(report.kpis.conversations)}
                delta={prev ? report.kpis.conversations - prev.conversations : undefined}
              />
              <Stat
                label="Leads novos"
                value={String(report.kpis.leads)}
                delta={prev ? report.kpis.leads - prev.leads : undefined}
              />
              <Stat
                label="Agendamentos"
                value={String(report.kpis.scheduled)}
                delta={prev ? report.kpis.scheduled - prev.scheduled : undefined}
              />
              <Stat
                label="Mensagens recebidas"
                value={String(report.kpis.inbound)}
                delta={prev ? report.kpis.inbound - prev.inbound : undefined}
              />
              <Stat
                label="Mensagens enviadas"
                value={String(report.kpis.outbound)}
                delta={prev ? report.kpis.outbound - prev.outbound : undefined}
              />
              <Stat
                label="Taxa de resposta"
                value={`${Math.round(report.kpis.responseRate * 100)}%`}
                hint={prev ? `antes ${Math.round(prev.responseRate * 100)}%` : undefined}
                about="Conversas em que o lead respondeu duas vezes ou mais."
              />
              <Stat label="Leads quentes" value={String(report.kpis.hotLeads)} hint="agora" />
              <Stat label="Precisam de você" value={String(report.kpis.needsHuman)} hint="agora" />
            </div>
          </FadeIn>

          <FadeIn>
            <div className="grid gap-6 lg:grid-cols-2">
              <ChartPanel
                variant="flow"
                title="Fluxo de mensagens"
                hint="Mensagens recebidas e enviadas ao longo do período."
                flow={report.flow}
              />
              <ChartPanel
                variant="results"
                title="Resultados"
                hint="O que as conversas geraram, período a período."
                results={report.results}
              />
            </div>
          </FadeIn>

          <FadeIn>
            <div className="grid gap-6 lg:grid-cols-2">
              <ChartPanel
                variant="attendance"
                title="Atendimento: IA x humano"
                hint="Contatos que a IA atendeu sozinha contra os que precisaram de uma pessoa."
                attendance={report.attendance}
              />
              <ChartPanel
                variant="closed"
                title="Leads fechados: IA x humano"
                hint="Agendamentos fechados pela IA contra os marcados manualmente."
                closed={report.closed}
              />
            </div>
          </FadeIn>

          <FadeIn>
            <div className="grid gap-6 lg:grid-cols-3">
              <ChartPanel
                variant="donut"
                title="Distribuição por agente"
                hint="Conversas ativas por agente."
                slices={report.byAgent}
              />
              <Card className="lg:col-span-2">
                <CardTitle hint="Status dos leads novos no período.">Leads por status</CardTitle>
                <StatusBreakdown data={report.byStatus} />
              </Card>
            </div>
          </FadeIn>

          <FadeIn>
            <div className="grid gap-6 lg:grid-cols-3">
              <ChartPanel
                variant="funnel"
                title="Funil de conversão"
                hint="De conversa a agendamento — quem entrou no período."
                funnel={report.funnel}
              />
              <ChartPanel
                variant="autonomyRate"
                title="Resolução autônoma"
                hint="Fração dos contatos atendidos que a IA resolveu sem um humano entrar."
                autonomyRate={report.autonomyRate}
              />
              <ChartPanel
                variant="followUpRecovery"
                title="Recuperação por follow-up"
                hint="Follow-ups automáticos enviados no período e quantos trouxeram o lead de volta."
                followUpRecovery={report.followUpRecovery}
              />
            </div>
          </FadeIn>

          <FadeIn>
            <div className="grid gap-6 lg:grid-cols-2">
              <ChartPanel
                variant="peakHours"
                title="Horários de pico"
                hint="Quando os leads mandam mensagem — dia da semana × hora, fuso de Brasília."
                peakHours={report.peakHours}
              />
              <ChartPanel
                variant="firstResponseTime"
                title="Tempo até a primeira resposta"
                hint="Quanto tempo passa entre a mensagem do lead e a primeira resposta."
                firstResponseTime={report.firstResponseTime}
              />
            </div>
          </FadeIn>

          <FadeIn>
            <ChartPanel
              variant="attendanceOutcome"
              title="Comparecimento e no-show"
              hint="Agendamentos do período, pelo status em que terminaram."
              attendanceOutcome={report.attendanceOutcome}
            />
          </FadeIn>
        </>
      ) : view === "financeiro" && financial ? (
        <FadeIn>
          <FinancialView summary={financial} />
        </FadeIn>
      ) : view === "afiliados" && affiliateOverview ? (
        <AfiliadoView overview={affiliateOverview} />
      ) : null}
    </div>
  );
}
