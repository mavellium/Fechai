import Link from "next/link";
import { ArrowUpRight, Bot, FileText, MessagesSquare, TriangleAlert } from "lucide-react";
import { requireTenant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getOnboardingSteps, requiredSteps, setupComplete } from "@/modules/tenants/onboarding";
import { computeHomeSummary } from "@/modules/reports/service";
import { planOf } from "@/modules/billing/plans";
import { getUsageSummary } from "@/modules/billing/usage";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { shortAge } from "@/lib/format";
import { leadStatusLabel } from "../conversas/leadStatus";
import { HealthStrip } from "./HealthStrip";
import { SetupSteps } from "./SetupSteps";
import { Sparkline } from "./Sparkline";

const PERIODS = [
  { key: "7", label: "7 dias" },
  { key: "30", label: "30 dias" },
];

/**
 * Saudação pelo horário de Brasília, e não pelo relógio do servidor: o produto é
 * brasileiro e o servidor pode rodar em UTC — "boa noite" às 15h seria só um
 * detalhe errado logo na primeira linha da tela.
 */
function greeting() {
  const hour = Number(
    new Intl.DateTimeFormat("pt-BR", {
      hour: "numeric",
      hour12: false,
      timeZone: "America/Sao_Paulo",
    }).format(new Date()),
  );
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

type RowConversation = {
  id: string;
  needsHuman: boolean;
  updatedAt: Date;
  lead: { name: string | null; phone: string; status: string };
  messages: { content: string }[];
};

function ConversationRow({ c }: { c: RowConversation }) {
  const status = leadStatusLabel(c.lead.status);

  return (
    <li>
      <Link
        href={`/conversas?status=all&id=${c.id}`}
        className="flex items-center gap-3 rounded-surface px-3 py-2.5 transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-sm font-medium text-white">
              {c.lead.name ?? c.lead.phone}
            </span>
            <time
              dateTime={c.updatedAt.toISOString()}
              className="shrink-0 font-mono text-micro text-white/45"
            >
              {shortAge(c.updatedAt)}
            </time>
          </span>
          <span className="mt-0.5 block truncate text-xs text-white/60">
            {c.messages[0]?.content ?? "Sem mensagens"}
          </span>
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge tone={status.tone}>{status.label}</Badge>
            {c.needsHuman && <Badge tone="danger">precisa de você</Badge>}
          </span>
        </span>
      </Link>
    </li>
  );
}

const SHORTCUTS = [
  { href: "/agentes", icon: Bot, label: "Ajustar o jeito de falar do agente" },
  { href: "/agentes", icon: FileText, label: "Enviar um novo documento" },
  { href: "/relatorios", icon: ArrowUpRight, label: "Ver o relatório completo" },
];

export default async function InicioPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string; periodo?: string }>;
}) {
  const { tenantId } = await requireTenant();
  const { checkout, periodo } = await searchParams;
  const days = periodo === "30" ? 30 : 7;

  const [tenant, steps] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId } }),
    getOnboardingSteps(tenantId),
  ]);

  const required = requiredSteps(steps);
  const doneCount = required.filter((s) => s.done).length;
  const allDone = setupComplete(steps);

  const checkoutAlert = checkout === "success" && (
    <Alert tone="success">Pagamento recebido! Seu plano será atualizado em instantes.</Alert>
  );

  // ── Fase 1: a conta ainda está sendo configurada ────────────────────────────
  // Enquanto falta passo, a home é sobre terminar o setup. Mostrar números que
  // ainda são zero só ocuparia a tela sem responder nada.
  if (!allDone) {
    const remaining = required.length - doneCount;

    return (
      <div className="mx-auto w-full max-w-3xl space-y-8">
        {checkoutAlert}
        <PageHeader
          eyebrow="início"
          title={`${greeting()}, ${tenant?.name ?? "bem-vindo"}`}
          description={
            remaining === 1
              ? "Falta um passo para seu agente atender sozinho."
              : `Faltam ${remaining} passos para seu agente atender sozinho.`
          }
        />
        <SetupSteps steps={steps} />
      </div>
    );
  }

  // ── Fase 2: a conta está no ar ──────────────────────────────────────────────
  const [summary, needsHuman, recent, whatsapp, agentReady, usage] =
    await Promise.all([
      computeHomeSummary(tenantId, days),
      // `isTest: false` em toda a home: o chat de teste não é atendimento e
      // não pode ocupar as listas de "precisa de você" e "conversas recentes".
      prisma.conversation.findMany({
        where: { tenantId, isTest: false, needsHuman: true },
        orderBy: { updatedAt: "desc" },
        take: 4,
        include: { lead: true, messages: { orderBy: { createdAt: "desc" }, take: 1 } },
      }),
      prisma.conversation.findMany({
        where: { tenantId, isTest: false },
        orderBy: { updatedAt: "desc" },
        take: 5,
        include: { lead: true, messages: { orderBy: { createdAt: "desc" }, take: 1 } },
      }),
      prisma.whatsappInstance.findUnique({ where: { tenantId }, select: { status: true } }),
      prisma.agent.findFirst({
        where: { tenantId, archived: false, NOT: { systemPrompt: "" } },
        select: { id: true },
      }),
      // A mesma fonte da sidebar e de /configuracoes — a home mostrava um
      // contador próprio (conversas do mês) que não era mais a cota real.
      getUsageSummary(tenantId),
    ]);

  const plan = planOf(tenant?.planKey);
  const periodLabel = days === 30 ? "nos últimos 30 dias" : "nos últimos 7 dias";

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6">
      {checkoutAlert}

      <PageHeader
        eyebrow="início"
        title={`${greeting()}, ${tenant?.name ?? "bem-vindo"}`}
        description="Seu agente está no ar. Aqui está o resumo do que aconteceu."
        actions={
          <ButtonLink href="/conversas" variant="outline" size="sm">
            Ver conversas
          </ButtonLink>
        }
      />

      <HealthStrip
        agentReady={Boolean(agentReady)}
        whatsappStatus={whatsapp?.status ?? "disconnected"}
        planName={plan.name}
        messagesUsed={usage.used}
        messageLimit={usage.limit}
        trialExpired={usage.trialExpired}
        trialDaysLeft={usage.isTrial && !usage.trialExpired ? usage.trialDaysLeft : null}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardTitle
              hint={`Conversas com atividade e leads novos ${periodLabel}.`}
              action={
                <FilterTabs
                  label="Período do resumo"
                  options={PERIODS}
                  active={String(days)}
                  href={(key) => `/inicio?periodo=${key}`}
                />
              }
            >
              Como foi por aqui
            </CardTitle>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Stat
                compact
                label="Conversas"
                value={String(summary.activeConversations)}
                delta={summary.deltaConversations}
              />
              <Stat
                compact
                label="Leads novos"
                value={String(summary.newLeads)}
                delta={summary.deltaLeads}
              />
              <Stat compact label="Leads quentes" value={String(summary.hotLeads)} hint="no total" />
              <Stat
                compact
                label="Precisam de você"
                value={String(summary.needsHuman)}
                hint="agora"
              />
            </div>

            <Sparkline data={summary.inboundByDay} label="mensagens recebidas por dia" />
          </Card>

          <Card>
            <CardTitle
              action={
                <Link
                  href="/conversas?status=all"
                  className="rounded-control font-mono text-micro uppercase tracking-wide text-iris underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
                >
                  Ver todas
                </Link>
              }
            >
              Últimas conversas
            </CardTitle>

            {recent.length === 0 ? (
              <EmptyState
                icon={MessagesSquare}
                title="Nenhuma conversa ainda"
                description="Seu agente está no ar esperando o primeiro cliente. Quer ver como ele responde antes disso? Faça um teste."
                action={<ButtonLink href="/conversas">Testar o agente</ButtonLink>}
                className="py-8"
              />
            ) : (
              <ul className="-mx-3 space-y-0.5">
                {recent.map((c) => (
                  <ConversationRow key={c.id} c={c} />
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            {/* Visível de propósito: este texto muda com o estado (tem ou não
                conversa parada) — é status do card, não descrição fixa. */}
            <CardTitle
              hintInline
              hint={
                needsHuman.length === 0
                  ? "Nada parado esperando por você."
                  : "O agente pediu ajuda nestas conversas."
              }
              action={
                needsHuman.length > 0 ? (
                  <Badge tone="danger" icon={<TriangleAlert size={11} />}>
                    {needsHuman.length}
                  </Badge>
                ) : undefined
              }
            >
              Precisa de você
            </CardTitle>

            {needsHuman.length === 0 ? (
              <p className="text-sm leading-relaxed text-white/55">
                Quando o agente não souber responder ou o cliente pedir uma pessoa, a conversa
                aparece aqui.
              </p>
            ) : (
              <ul className="-mx-3 space-y-0.5">
                {needsHuman.map((c) => (
                  <ConversationRow key={c.id} c={c} />
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardTitle as="h2">Atalhos</CardTitle>
            <ul className="-mx-3 space-y-0.5">
              {SHORTCUTS.map((s) => (
                <li key={s.label}>
                  <Link
                    href={s.href}
                    className="flex items-center gap-3 rounded-surface px-3 py-2 text-sm text-white/75 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
                  >
                    <s.icon size={15} aria-hidden className="shrink-0 text-white/45" />
                    <span className="min-w-0">{s.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
